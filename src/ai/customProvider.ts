import { window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from '../container';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import type { AIProvider } from './aiProviderService';
import { getApiKey as getApiKeyCore, getMaxCharacters } from './aiProviderService';

export class CustomProvider implements AIProvider<'custom'> {
	readonly id = 'custom';
	readonly name = 'Custom';

	constructor(private readonly container: Container) {}

	dispose() {}

	private get model(): CustomModels | null {
		return configuration.get('ai.experimental.custom.model') || null;
	}

	private get url(): string {
		return configuration.get('ai.experimental.custom.url') || 'https://api.custom.com/v1/chat/completions';
	}

	private async getOrChooseModel(): Promise<CustomModels | undefined> {
		const model = this.model;
		if (model != null) return model;

		const pick = await showAIModelPicker(this.id);
		if (pick == null) return undefined;

		await configuration.updateEffective(`ai.experimental.${pick.provider}.model`, pick.model);
		return pick.model;
	}

	async generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 2600);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
			if (!customPrompt.endsWith('.')) {
				customPrompt += '.';
			}

			const request: CustomChatCompletionRequest = {
				model: model,
				messages: [
					{
						role: 'system',
						content: `You are an advanced AI programming assistant tasked with summarizing code changes into a concise and meaningful commit message. Compose a commit message that:
- Strictly synthesizes meaningful information from the provided code diff
- Utilizes any additional user-provided context to comprehend the rationale behind the code changes
- Is clear and brief, with an informal yet professional tone, and without superfluous descriptions
- Avoids unnecessary phrases such as "this commit", "this change", and the like
- Avoids direct mention of specific code identifiers, names, or file names, unless they are crucial for understanding the purpose of the changes
- Most importantly emphasizes the 'why' of the change, its benefits, or the problem it addresses rather than only the 'what' that changed

Follow the user's instructions carefully, don't repeat yourself, don't include the code in the output, or make anything up!`,
					},
					{
						role: 'user',
						content: `Here is the code diff to use to generate the commit message:\n\n${code}`,
					},
					...(options?.context
						? [
								{
									role: 'user' as const,
									content: `Here is additional context which should be taken into account when generating the commit message:\n\n${options.context}`,
								},
						  ]
						: []),
					{
						role: 'user',
						content: customPrompt,
					},
				],
			};

			const rsp = await this.fetch(apiKey, request);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(
						`Unable to generate commit message: Your API key doesn't seem to have access to the selected '${model}' model`,
					);
				}
				if (rsp.status === 429) {
					throw new Error(
						`Unable to generate commit message: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to generate commit message: (${this.name}:${rsp.status}) ${
						json?.error?.message || rsp.statusText
					}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Custom's limits.`,
				);
			}

			const data: CustomChatCompletionResponse = await rsp.json();
			const message = data.choices[0].message.content.trim();
			return message;
		}
	}

	async explainChanges(message: string, diff: string): Promise<string | undefined> {
		const apiKey = await getApiKey(this.container.storage);
		if (apiKey == null) return undefined;

		const model = await this.getOrChooseModel();
		if (model == null) return undefined;

		let retries = 0;
		let maxCodeCharacters = getMaxCharacters(model, 3000);
		while (true) {
			const code = diff.substring(0, maxCodeCharacters);

			const request: CustomChatCompletionRequest = {
				model: model,
				messages: [
					{
						role: 'system',
						content: `You are an advanced AI programming assistant tasked with summarizing code changes into an explanation that is both easy to understand and meaningful. Construct an explanation that:
- Concisely synthesizes meaningful information from the provided code diff
- Incorporates any additional context provided by the user to understand the rationale behind the code changes
- Places the emphasis on the 'why' of the change, clarifying its benefits or addressing the problem that necessitated the change, beyond just detailing the 'what' has changed

Do not make any assumptions or invent details that are not supported by the code diff or the user-provided context.`,
					},
					{
						role: 'user',
						content: `Here is additional context provided by the author of the changes, which should provide some explanation to why these changes where made. Please strongly consider this information when generating your explanation:\n\n${message}`,
					},
					{
						role: 'user',
						content: `Now, kindly explain the following code diff in a way that would be clear to someone reviewing or trying to understand these changes:\n\n${code}`,
					},
					{
						role: 'user',
						content:
							'Remember to frame your explanation in a way that is suitable for a reviewer to quickly grasp the essence of the changes, the issues they resolve, and their implications on the codebase.',
					},
				],
			};

			const rsp = await this.fetch(apiKey, request);
			if (!rsp.ok) {
				if (rsp.status === 404) {
					throw new Error(
						`Unable to explain commit: Your API key doesn't seem to have access to the selected '${model}' model`,
					);
				}
				if (rsp.status === 429) {
					throw new Error(
						`Unable to explain commit: (${this.name}:${rsp.status}) Too many requests (rate limit exceeded) or your API key is associated with an expired trial`,
					);
				}

				let json;
				try {
					json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
				} catch {}

				debugger;

				if (retries++ < 2 && json?.error?.code === 'context_length_exceeded') {
					maxCodeCharacters -= 500 * retries;
					continue;
				}

				throw new Error(
					`Unable to explain commit: (${this.name}:${rsp.status}) ${json?.error?.message || rsp.statusText}`,
				);
			}

			if (diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the changes had to be truncated to ${maxCodeCharacters} characters to fit within the Custom's limits.`,
				);
			}

			const data: CustomChatCompletionResponse = await rsp.json();
			const summary = data.choices[0].message.content.trim();
			return summary;
		}
	}

	private fetch(apiKey: string, request: CustomChatCompletionRequest) {
		const url = this.url;
		const isAzure = url.includes('.azure.com');
		return fetch(url, {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(isAzure ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
			},
			method: 'POST',
			body: JSON.stringify(request),
		});
	}
}

async function getApiKey(storage: Storage): Promise<string | undefined> {
	return getApiKeyCore(storage, {
		id: 'custom',
		name: 'Custom',
		validator: v => /(?:sk-)?[a-zA-Z0-9]{32,}/.test(v),
		url: 'https://platform.custom.com/account/api-keys',
	});
}

export type CustomModels =
	| 'gpt-4-turbo'
	| 'gpt-4-turbo-2024-04-09'
	| 'gpt-4-turbo-preview'
	| 'gpt-4-0125-preview'
	| 'gpt-4-1106-preview'
	| 'gpt-4'
	| 'gpt-4-0613'
	| 'gpt-4-32k'
	| 'gpt-4-32k-0613'
	| 'gpt-3.5-turbo'
	| 'gpt-3.5-turbo-0125'
	| 'gpt-3.5-turbo-1106'
	| 'gpt-3.5-turbo-16k';

interface CustomChatCompletionRequest {
	model: CustomModels;
	messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
	temperature?: number;
	top_p?: number;
	n?: number;
	stream?: boolean;
	stop?: string | string[];
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	logit_bias?: Record<string, number>;
	user?: string;
}

interface CustomChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: {
		index: number;
		message: {
			role: 'system' | 'user' | 'assistant';
			content: string;
		};
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}