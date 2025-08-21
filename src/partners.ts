import type { CancellationTokenSource, Extension, ExtensionContext, Uri } from 'vscode';
import { extensions } from 'vscode';
import type { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import type { InviteToLiveShareCommandArgs } from './commands/inviteToLiveShare';
import { Container } from './container';
import { executeCommand, executeCoreCommand } from './system/-webview/command';
import type { ContactPresence } from './vsls/vsls';

export async function installExtension<T>(
	extensionId: string,
	tokenSource: CancellationTokenSource,
	timeout: number,
	vsix?: Uri,
): Promise<Extension<T> | undefined> {
	try {
		// Add comprehensive logging for debugging extension signature verification issues
		console.log(`[DEBUG-4541] installExtension called with: extensionId=${extensionId}, timeout=${timeout}, vsix=${vsix?.toString() || 'none'}`);

		let timer: ReturnType<typeof setTimeout> | undefined = undefined;
		const extension = new Promise<Extension<any> | undefined>(resolve => {
			const disposable = extensions.onDidChange(() => {
				console.log(`[DEBUG-4541] Extensions changed event fired`);
				const extension = extensions.getExtension(extensionId);
				console.log(`[DEBUG-4541] Extension found after change: ${extension ? 'yes' : 'no'}`);
				if (extension != null) {
					if (timer != null) {
						console.log(`[DEBUG-4541] Clearing timer and disposing listener`);
						clearTimeout(timer);
						timer = undefined;
					}
					disposable.dispose();

					resolve(extension);
				}
			});

			tokenSource.token.onCancellationRequested(() => {
				console.log(`[DEBUG-4541] Token cancellation requested`);
				disposable.dispose();

				resolve(undefined);
			});
		});

		console.log(`[DEBUG-4541] Executing workbench.extensions.installExtension command`);
		await executeCoreCommand('workbench.extensions.installExtension', vsix ?? extensionId);
		console.log(`[DEBUG-4541] Install command executed successfully`);

		// Wait for extension activation until timeout expires
		timer = setTimeout(() => {
			console.log(`[DEBUG-4541] Timeout reached, cancelling token`);
			timer = undefined;
			tokenSource.cancel();
		}, timeout);

		console.log(`[DEBUG-4541] Waiting for extension to be available...`);
		const result = await extension;
		console.log(`[DEBUG-4541] Extension installation result: ${result ? 'success' : 'failed'}`);
		return result;
	} catch (error) {
		console.error(`[DEBUG-4541] Error in installExtension:`, error);
		console.log(`[DEBUG-4541] Error name: ${error?.name}`);
		console.log(`[DEBUG-4541] Error message: ${error?.message}`);
		console.log(`[DEBUG-4541] Error stack: ${error?.stack}`);
		tokenSource.cancel();
		return undefined;
	}
}

export function registerPartnerActionRunners(context: ExtensionContext): void {
	registerLiveShare(context);
}

function registerLiveShare(context: ExtensionContext) {
	context.subscriptions.push(
		Container.instance.actionRunners.registerBuiltInPartner<HoverCommandsActionContext>(
			'liveshare',
			'hover.commands',
			{
				name: 'Live Share',
				label: (context: ActionContext) => {
					if (context.type === 'hover.commands') {
						if (context.commit.author.name !== 'You') {
							return `$(live-share) Invite ${context.commit.author.name}${
								(context.commit.author.presence as ContactPresence)?.statusText
									? ` (${(context.commit.author.presence as ContactPresence)?.statusText})`
									: ''
							} to a Live Share Session`;
						}
					}

					return '$(live-share) Start a Live Share Session';
				},
				run: async (context: ActionContext) => {
					if (context.type !== 'hover.commands' || context.commit.author.name === 'You') {
						await executeCommand<InviteToLiveShareCommandArgs>('gitlens.inviteToLiveShare', {});

						return;
					}

					await executeCommand<InviteToLiveShareCommandArgs>('gitlens.inviteToLiveShare', {
						email: context.commit.author.email,
					});
				},
			},
		),
	);
}
