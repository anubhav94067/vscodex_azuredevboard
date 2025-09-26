import * as vscode from 'vscode';
import { WorkItemsProvider, WorkItem, fetchDetailedWorkItems, AzDoWorkItem } from './WorkItemProvider';

let statusBarItem: vscode.StatusBarItem;
let timerInterval: NodeJS.Timeout | undefined;
let seconds = 0;

export function activate(context: vscode.ExtensionContext) {
    // Register configuration command
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.configure', async () => {
        const organization = await vscode.window.showInputBox({ 
            prompt: 'Enter your Azure DevOps organization name',
            value: context.globalState.get('organization') || ''
        });
        const project = await vscode.window.showInputBox({ 
            prompt: 'Enter your Azure DevOps project name',
            value: context.globalState.get('project') || ''
        });
        const personalAccessToken = await vscode.window.showInputBox({ 
            prompt: 'Enter your Azure DevOps Personal Access Token (PAT)', 
            password: true,
            value: context.globalState.get('personalAccessToken') || ''
        });
        const queryId = await vscode.window.showInputBox({ 
            prompt: 'Enter the ID of your saved query',
            value: context.globalState.get('queryId') || ''
        });
        console.log(`[Configure] User entered Query ID: ${queryId}`);

        if (organization && project && personalAccessToken && queryId) {
            await context.globalState.update('organization', organization);
            await context.globalState.update('project', project);
            await context.globalState.update('personalAccessToken', personalAccessToken);
            await context.globalState.update('queryId', queryId);
            console.log(`[Configure] Storing Query ID: ${queryId}`);
            vscode.window.showInformationMessage('Azure DevOps settings saved successfully!');
            vscode.commands.executeCommand('azure-devops-time-tracker.refreshWorkItems');
        }
    }));

    // Tree view for work items
    const workItemsProvider = new WorkItemsProvider(context);
    vscode.window.registerTreeDataProvider('azureDevopsWorkItems', workItemsProvider);

    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.refreshWorkItems', () => workItemsProvider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.startTimer', (item: WorkItem) => startTimer(context, item, workItemsProvider)));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.stopTimer', (item: WorkItem) => stopTimer(context, item, workItemsProvider)));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.openWorkItemInBrowser', (item: WorkItem) => openWorkItemInBrowser(context, item)));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.closeWorkItem', (item: WorkItem) => closeWorkItem(context, item, workItemsProvider)));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.showWorkItemsInView', () => showWorkItemsInView(context)));
    context.subscriptions.push(vscode.commands.registerCommand('azure-devops-time-tracker.openWorkItemInView', (item: WorkItem | AzDoWorkItem | undefined) => openWorkItemInView(context, item)));

    // Status bar item for the timer
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'azure-devops-time-tracker.stopTimer';
    context.subscriptions.push(statusBarItem);
    
    // Check if configuration exists
    const org = context.globalState.get('organization');
    const project = context.globalState.get('project');
    const pat = context.globalState.get('personalAccessToken');
    const queryId = context.globalState.get('queryId');
    console.log(`[Activate] Retrieved Query ID from storage: ${queryId}`);

    if (!org || !project || !pat || !queryId) {
        vscode.window.showInformationMessage('Please configure the Azure DevOps Time Tracker extension.', 'Configure').then(selection => {
            if (selection === 'Configure') {
                vscode.commands.executeCommand('azure-devops-time-tracker.configure');
            }
        });
    }
}

async function startTimer(context: vscode.ExtensionContext, workItem: WorkItem, provider: WorkItemsProvider) {
    const activeId = context.globalState.get('activeWorkItemId');
    if (activeId) {
        vscode.window.showWarningMessage(`Timer is already running for Work Item ${activeId}. Please stop it before starting a new one.`);
        return;
    }
    
    await context.globalState.update('activeWorkItemId', workItem.id);
    provider.refresh(); // Refresh the tree to show the stop button

    seconds = 0;
    statusBarItem.text = `$(watch) WI-${workItem.id}: 00:00:00`;
    statusBarItem.tooltip = `Stop timer for Work Item ${workItem.id}`;
    statusBarItem.show();

    timerInterval = setInterval(() => {
        seconds++;
        let h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        let m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        let s = Math.floor(seconds % 60).toString().padStart(2, '0');
        statusBarItem.text = `$(watch) WI-${workItem.id}: ${h}:${m}:${s}`;
    }, 1000);
}

async function stopTimer(context: vscode.ExtensionContext, workItem: WorkItem, provider: WorkItemsProvider) {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    const timeSpent = seconds / 3600; // Time in hours
    const activeId = context.globalState.get('activeWorkItemId');
    
    const selection = await vscode.window.showInformationMessage(
        `Timer stopped for WI-${activeId}. Total time: ${timeSpent.toFixed(2)} hours.`, 
        'Log Time Directly', 
        'Log Time in Browser'
    );
    
    if (selection === 'Log Time in Browser') {
        openWorkItemInBrowser(context, workItem);
    } else if (selection === 'Log Time Directly') {
        await logTimeDirectly(context, workItem, timeSpent);
    }

    await context.globalState.update('activeWorkItemId', undefined);
    provider.refresh(); // Refresh the tree to show the start button again
    statusBarItem.hide();
}

async function logTimeDirectly(context: vscode.ExtensionContext, workItem: WorkItem, timeSpent: number) {
    try {
        // Get user input for the time entry with ability to modify the time
        const timeInput = await vscode.window.showInputBox({
            prompt: 'Enter the time to log (in hours)',
            value: timeSpent.toFixed(2),
            placeHolder: 'e.g., 2.5',
            validateInput: (value) => {
                const num = parseFloat(value);
                if (isNaN(num) || num <= 0) {
                    return 'Please enter a valid positive number for hours';
                }
                return null;
            }
        });

        // If user cancels time input, don't proceed
        if (timeInput === undefined) {
            return;
        }

        const finalTimeSpent = parseFloat(timeInput);

        // Get user input for the comment
        const comment = await vscode.window.showInputBox({
            prompt: 'Enter a comment for this time entry (optional)',
            placeHolder: `Logging ${finalTimeSpent} hours of work`
        });

        // If user cancels comment input, don't proceed
        if (comment === undefined) {
            return;
        }

        const organization = context.globalState.get<string>('organization');
        const project = context.globalState.get<string>('project');
        const pat = context.globalState.get<string>('personalAccessToken');

        if (!organization || !project || !pat) {
            vscode.window.showErrorMessage('Azure DevOps configuration is missing. Please configure the extension first.');
            return;
        }

        const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
        const axios = require('axios');
        
        // First, fetch the current work item to get existing completed work, remaining work, and state
        const getUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${workItem.id}?fields=Microsoft.VSTS.Scheduling.CompletedWork,Microsoft.VSTS.Scheduling.RemainingWork,System.State&api-version=6.0`;
        const currentWorkItem = await axios.get(getUrl, {
            headers: { 'Authorization': authHeader }
        });

        // Get existing values (default to 0 if not set)
        const existingCompletedWork = currentWorkItem.data.fields['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
        const existingRemainingWork = currentWorkItem.data.fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
        const currentState = currentWorkItem.data.fields['System.State'];
        
        const newTotalCompleted = existingCompletedWork + finalTimeSpent;
        const newRemainingWork = Math.max(0, existingRemainingWork - finalTimeSpent); // Don't go below 0
        
        // Create the work log entries
        const patches = [
            {
                op: 'add',
                path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork',
                value: newTotalCompleted.toFixed(2)
            },
            {
                op: 'add',
                path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
                value: newRemainingWork.toFixed(2)
            }
        ];

        // If the work item is not already Active, set it to Active when logging effort
        if (currentState !== 'Active') {
            patches.push({
                op: 'add',
                path: '/fields/System.State',
                value: 'Active'
            });
        }
        // If there's a comment, add it to history
        const stateChangeText = currentState !== 'Active' ? ' (State changed to Active)' : '';
        if (comment && comment.trim() !== '') {
            patches.push({
                op: 'add',
                path: '/fields/System.History',
                value: `Time logged: ${finalTimeSpent.toFixed(2)} hours (Completed: ${newTotalCompleted.toFixed(2)}h, Remaining: ${newRemainingWork.toFixed(2)}h)${stateChangeText} - ${comment}`
            });
        } else {
            patches.push({
                op: 'add',
                path: '/fields/System.History',
                value: `Time logged: ${finalTimeSpent.toFixed(2)} hours (Completed: ${newTotalCompleted.toFixed(2)}h, Remaining: ${newRemainingWork.toFixed(2)}h)${stateChangeText}`
            });
        }

        const updateUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${workItem.id}?api-version=6.0`;
        
        await axios.patch(updateUrl, patches, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json-patch+json'
            }
        });

        const stateMessage = currentState !== 'Active' ? ' State updated to Active.' : '';
        vscode.window.showInformationMessage(`Successfully logged ${finalTimeSpent.toFixed(2)} hours to Work Item ${workItem.id}. Completed: ${newTotalCompleted.toFixed(2)}h, Remaining: ${newRemainingWork.toFixed(2)}h.${stateMessage}`);

        // Refresh the tree view to show updated state
        vscode.commands.executeCommand('azure-devops-time-tracker.refreshWorkItems');

    } catch (error: any) {
        console.error('Error logging time directly:', error);
        if (error.response) {
            vscode.window.showErrorMessage(`Failed to log time: ${error.response.status} ${error.response.statusText}`);
        } else {
            vscode.window.showErrorMessage('Failed to log time: ' + error.message);
        }
    }
}

async function openWorkItemInBrowser(context: vscode.ExtensionContext, workItem: WorkItem) {
    const organization = context.globalState.get<string>('organization');
    const project = context.globalState.get<string>('project');

    if (organization && project && workItem.id && workItem.id !== 'message') {
        const url = `https://dev.azure.com/${organization}/${project}/_workitems/edit/${workItem.id}`;
        
        // Azure DevOps doesn't allow embedding due to X-Frame-Options: sameorigin
        // So we must use external browser
        vscode.env.openExternal(vscode.Uri.parse(url));
    } else {
        vscode.window.showWarningMessage('Could not open work item. Configuration is missing or work item is invalid.');
    }
}

async function closeWorkItem(context: vscode.ExtensionContext, workItem: WorkItem, provider: WorkItemsProvider) {
    try {
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to close Work Item ${workItem.id}? This will set its state to "Closed".`,
            'Yes, Close Item',
            'Cancel'
        );

        if (confirmation !== 'Yes, Close Item') {
            return;
        }

        // Get optional closing comment
        const comment = await vscode.window.showInputBox({
            prompt: 'Enter a closing comment (optional)',
            placeHolder: `Work Item ${workItem.id} completed`
        });

        // If user cancels comment input, don't proceed
        if (comment === undefined) {
            return;
        }

        const organization = context.globalState.get<string>('organization');
        const project = context.globalState.get<string>('project');
        const pat = context.globalState.get<string>('personalAccessToken');

        if (!organization || !project || !pat) {
            vscode.window.showErrorMessage('Azure DevOps configuration is missing. Please configure the extension first.');
            return;
        }

        const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
        const axios = require('axios');
        
        // Create the patches to close the work item
        const patches = [
            {
                op: 'add',
                path: '/fields/System.State',
                value: 'Closed'
            }
        ];

        // Add comment to history if provided
        if (comment && comment.trim() !== '') {
            patches.push({
                op: 'add',
                path: '/fields/System.History',
                value: `Work item closed: ${comment}`
            });
        } else {
            patches.push({
                op: 'add',
                path: '/fields/System.History',
                value: 'Work item closed automatically (no remaining work)'
            });
        }

        const updateUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${workItem.id}?api-version=6.0`;
        
        await axios.patch(updateUrl, patches, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json-patch+json'
            }
        });

        vscode.window.showInformationMessage(`Successfully closed Work Item ${workItem.id}.`);

        // Refresh the tree view to show updated state
        vscode.commands.executeCommand('azure-devops-time-tracker.refreshWorkItems');

    } catch (error: any) {
        console.error('Error closing work item:', error);
        if (error.response) {
            vscode.window.showErrorMessage(`Failed to close work item: ${error.response.status} ${error.response.statusText}`);
        } else {
            vscode.window.showErrorMessage('Failed to close work item: ' + error.message);
        }
    }
}

async function showWorkItemsInView(context: vscode.ExtensionContext) {
    const organization = context.globalState.get<string>('organization') || '';
    const project = context.globalState.get<string>('project') || '';

    const panel = vscode.window.createWebviewPanel(
        'azureDevopsWorkItemsView',
        'Azure DevOps Work Items',
        vscode.ViewColumn.Active,
        {
            enableScripts: false,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getLoadingHtml(panel.webview);

    const workItems = await fetchDetailedWorkItems(context);

    if (workItems === null) {
        panel.webview.html = getInformationalHtml(panel.webview, 'Unable to load work items', 'Check your configuration and try again.');
        return;
    }

    if (workItems.length === 0) {
        panel.webview.html = getInformationalHtml(panel.webview, 'No work items found', 'The selected query did not return any work items.');
        return;
    }

    panel.webview.html = getWorkItemsWebviewContent(panel.webview, workItems, organization, project);
}

async function openWorkItemInView(context: vscode.ExtensionContext, item: WorkItem | AzDoWorkItem | undefined) {
    if (!item) {
        vscode.window.showWarningMessage('No work item selected.');
        return;
    }

    const organization = context.globalState.get<string>('organization');
    const project = context.globalState.get<string>('project');
    const pat = context.globalState.get<string>('personalAccessToken');

    if (!organization || !project || !pat) {
        vscode.window.showErrorMessage('Azure DevOps configuration is missing. Please configure the extension first.');
        return;
    }

    let workItemData: AzDoWorkItem | null = null;
    let targetId: number | undefined;

    if ('workItemData' in (item as WorkItem)) {
        const treeItem = item as WorkItem;
        if (treeItem.id === 'message') {
            vscode.window.showInformationMessage('No actionable work item selected.');
            return;
        }
        workItemData = treeItem.workItemData;
        targetId = treeItem.workItemData.id;
    } else if ('fields' in (item as AzDoWorkItem)) {
        workItemData = item as AzDoWorkItem;
        targetId = workItemData.id;
    } else if ('id' in (item as any)) {
        const parsed = parseInt(String((item as any).id), 10);
        if (!isNaN(parsed)) {
            targetId = parsed;
        }
    }

    if (!workItemData && targetId !== undefined) {
        workItemData = await fetchWorkItemById(context, targetId);
    }

    if (!workItemData) {
        vscode.window.showErrorMessage('Unable to load work item details.');
        return;
    }

    let discussionEntries: WorkItemDiscussionEntry[] = [];
    if (targetId !== undefined) {
        try {
            discussionEntries = await fetchWorkItemDiscussion(context, targetId);
        } catch (error) {
            console.error('Error fetching work item discussion:', error);
            vscode.window.showWarningMessage('Some discussion items could not be loaded.');
        }
    }

    const panel = vscode.window.createWebviewPanel(
        'azureDevopsWorkItemDetail',
        `Work Item ${workItemData.id}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: false,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getWorkItemDetailContent(panel.webview, workItemData, organization, project, discussionEntries);
}

async function fetchWorkItemById(context: vscode.ExtensionContext, id: number): Promise<AzDoWorkItem | null> {
    const organization = context.globalState.get<string>('organization');
    const project = context.globalState.get<string>('project');
    const pat = context.globalState.get<string>('personalAccessToken');

    if (!organization || !project || !pat) {
        return null;
    }

    const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
    const axios = require('axios');
    const detailsUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${id}?fields=System.Title,System.State,Microsoft.VSTS.Scheduling.RemainingWork,System.WorkItemType,System.Description&api-version=6.0`;

    try {
        const response = await axios.get(detailsUrl, {
            headers: { Authorization: authHeader }
        });

        if (!response.data) {
            return null;
        }

        return {
            id: response.data.id,
            fields: response.data.fields
        } as AzDoWorkItem;
    } catch (error: any) {
        console.error('Error fetching work item details:', error);
        if (error.response) {
            vscode.window.showErrorMessage(`Failed to load work item: ${error.response.status} ${error.response.statusText}`);
        } else {
            vscode.window.showErrorMessage('Failed to load work item: ' + error.message);
        }
        return null;
    }
}

async function fetchWorkItemComments(context: vscode.ExtensionContext, id: number): Promise<WorkItemDiscussionEntry[]> {
    const organization = context.globalState.get<string>('organization');
    const project = context.globalState.get<string>('project');
    const pat = context.globalState.get<string>('personalAccessToken');

    if (!organization || !project || !pat) {
        return [];
    }

    const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
    const axios = require('axios');
    const commentsUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workItems/${id}/comments?api-version=7.0-preview.3`;

    try {
        const response = await axios.get(commentsUrl, {
            headers: { Authorization: authHeader }
        });

        const comments = Array.isArray(response.data?.comments) ? response.data.comments : [];
        return comments
            .filter((comment: any) => !!comment?.text)
            .map((comment: any) => ({
                id: String(comment.id ?? comment.url ?? Math.random()),
                text: comment.text || '',
                createdBy: {
                    displayName: comment.createdBy?.displayName || 'Unknown',
                    imageUrl: comment.createdBy?.imageUrl
                },
                createdDate: comment.createdDate || new Date().toISOString(),
                source: 'comment' as const
            }));
    } catch (error) {
        console.error('Error fetching comments:', error);
        return [];
    }
}

async function fetchWorkItemHistory(context: vscode.ExtensionContext, id: number): Promise<WorkItemDiscussionEntry[]> {
    const organization = context.globalState.get<string>('organization');
    const project = context.globalState.get<string>('project');
    const pat = context.globalState.get<string>('personalAccessToken');

    if (!organization || !project || !pat) {
        return [];
    }

    const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
    const axios = require('axios');
    const updatesUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workItems/${id}/updates?api-version=6.0`;

    try {
        const response = await axios.get(updatesUrl, {
            headers: { Authorization: authHeader }
        });

        const updates = Array.isArray(response.data?.value) ? response.data.value : [];
        return updates
            .filter((update: any) => update?.fields && update.fields['System.State'])
            .map((update: any) => {
                const fromState = update.fields['System.State']?.oldValue || 'Unknown';
                const toState = update.fields['System.State']?.newValue || 'Unknown';
                const authorName = update.revisedBy?.displayName || 'System';
                const text = `<p>State changed from <strong>${fromState}</strong> to <strong>${toState}</strong>.</p>`;
                return {
                    id: String(update.id ?? `${fromState}-${toState}-${update.revisedDate}`),
                    text,
                    createdBy: {
                        displayName: authorName,
                        imageUrl: update.revisedBy?.imageUrl
                    },
                    createdDate: update.revisedDate || new Date().toISOString(),
                    source: 'history' as const
                } as WorkItemDiscussionEntry;
            });
    } catch (error) {
        console.error('Error fetching work item history:', error);
        return [];
    }
}

async function fetchWorkItemDiscussion(context: vscode.ExtensionContext, id: number): Promise<WorkItemDiscussionEntry[]> {
    const [comments, history] = await Promise.all([
        fetchWorkItemComments(context, id),
        fetchWorkItemHistory(context, id)
    ]);

    return [...comments, ...history]
        .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
}

function formatDiscussionTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getWorkItemsWebviewContent(webview: vscode.Webview, workItems: AzDoWorkItem[], organization: string, project: string): string {
    const styleSource = webview.cspSource;
    const cards = workItems.map(item => {
        const typeInfo = getWorkItemTypeStyle(item.fields['System.WorkItemType'] || 'Work Item');
        const title = escapeHtml(item.fields['System.Title'] || 'Untitled');
        const state = escapeHtml(item.fields['System.State'] || 'Unknown');
        const remaining = item.fields['Microsoft.VSTS.Scheduling.RemainingWork'];
        const remainingText = remaining !== undefined ? `${remaining.toFixed(2)}h remaining` : 'Remaining work not set';
        const descriptionRaw = sanitizeWorkItemHtml(item.fields['System.Description'] || '');
        const excerpt = truncateText(stripHtml(descriptionRaw) || 'No description provided.', 160);
        const styleVariables = `--type-primary:${typeInfo.heroPrimary};--type-secondary:${typeInfo.heroSecondary};--type-muted:${typeInfo.heroTint};--type-chip-bg:${typeInfo.badgeBackground};--type-chip-border:${typeInfo.badgeBorder};--type-chip-color:${typeInfo.badgeColor};`;

        return `<article class="work-item" style="${styleVariables}">
            <header class="work-item__header">
                <span class="work-item__type">${escapeHtml(typeInfo.label)}</span>
                <span class="work-item__id">#${item.id}</span>
            </header>
            <h2 class="work-item__title">${title}</h2>
            <p class="work-item__meta">${state} • ${escapeHtml(remainingText)}</p>
            <p class="work-item__excerpt">${escapeHtml(excerpt)}</p>
        </article>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Azure DevOps Work Items</title>
    <style>
        :root {
            color-scheme: light;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            --canvas: var(--vscode-editor-background, #f3f4f6);
            --card-shadow: 0 18px 32px rgba(15, 23, 42, 0.12);
            --card-border: var(--vscode-editorGroup-border, rgba(148, 163, 184, 0.32));
            --text-primary: var(--vscode-editor-foreground, #1f2933);
            --text-muted: var(--vscode-descriptionForeground, #52606d);
        }
        body {
            margin: 0;
            background: var(--canvas);
            color: var(--text-primary);
        }
        header {
            padding: 32px 32px 16px;
        }
        header h1 {
            margin: 0;
            font-size: clamp(2rem, 3vw, 2.6rem);
        }
        header .subtitle {
            margin: 8px 0 0;
            color: var(--text-muted);
            font-size: 1rem;
        }
        .work-items-grid {
            display: grid;
            gap: 24px;
            padding: 0 32px 48px;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }
        .work-item {
            background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.6));
            border-radius: 20px;
            padding: 24px;
            border: 1px solid var(--card-border);
            box-shadow: var(--card-shadow);
            backdrop-filter: blur(12px);
            transition: transform 120ms ease, box-shadow 180ms ease;
            position: relative;
            overflow: hidden;
        }
        .work-item::before {
            content: '';
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at top right, var(--type-muted, rgba(96, 165, 250, 0.16)), transparent 60%);
            opacity: 0.85;
        }
        .work-item:hover {
            transform: translateY(-6px);
            box-shadow: 0 24px 42px rgba(15, 23, 42, 0.18);
        }
        .work-item__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            position: relative;
            z-index: 1;
        }
        .work-item__type {
            padding: 6px 16px;
            border-radius: 999px;
            font-size: 0.68rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            background: var(--type-chip-bg, rgba(96, 165, 250, 0.18));
            color: var(--type-chip-color, #1e3a8a);
            border: 1px solid var(--type-chip-border, rgba(96, 165, 250, 0.35));
        }
        .work-item__id {
            font-size: 0.85rem;
            color: var(--text-muted);
        }
        .work-item__title {
            margin: 0 0 12px;
            font-size: 1.35rem;
            line-height: 1.35;
            position: relative;
            z-index: 1;
        }
        .work-item__meta {
            margin: 0 0 18px;
            color: var(--text-muted);
            font-size: 0.9rem;
            position: relative;
            z-index: 1;
        }
        .work-item__excerpt {
            margin: 0;
            font-size: 0.92rem;
            line-height: 1.55;
            color: rgba(15, 23, 42, 0.85);
            position: relative;
            z-index: 1;
        }
        @media (max-width: 720px) {
            header {
                padding: 24px 20px 12px;
            }
            .work-items-grid {
                padding: 0 20px 32px;
                gap: 20px;
            }
            .work-item {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <header>
        <h1>Azure DevOps Work Items</h1>
        <p class="subtitle">${escapeHtml(project || 'Project not set')} • ${escapeHtml(organization || 'Organization not set')}</p>
    </header>
    <section class="work-items-grid">
        ${cards}
    </section>
</body>
</html>`;
}

function getWorkItemDetailContent(webview: vscode.Webview, workItem: AzDoWorkItem, organization: string, project: string, discussion: WorkItemDiscussionEntry[]): string {
    const styleSource = webview.cspSource;
    const titleRaw = workItem.fields['System.Title'] || 'Untitled';
    const stateRaw = workItem.fields['System.State'] || 'Unknown';
    const typeRaw = workItem.fields['System.WorkItemType'] || 'Work Item';
    const typeInfo = getWorkItemTypeStyle(typeRaw);
    const remaining = workItem.fields['Microsoft.VSTS.Scheduling.RemainingWork'];
    const descriptionRaw = workItem.fields['System.Description'] || '';

    const title = escapeHtml(titleRaw);
    const state = escapeHtml(stateRaw);
    const workItemType = escapeHtml(typeInfo.label);
    const projectLabel = escapeHtml(project || 'Project not set');
    const organizationLabel = escapeHtml(organization || 'Organization not set');
    const stateSlug = stateRaw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unknown';
    const typeSlug = typeInfo.slug;
    const remainingDisplay = remaining !== undefined ? `${remaining.toFixed(2)}h` : 'Not set';
    const heroStyle = `--type-primary:${typeInfo.heroPrimary};--type-secondary:${typeInfo.heroSecondary};--type-muted:${typeInfo.heroTint};--type-chip-bg:${typeInfo.badgeBackground};--type-chip-border:${typeInfo.badgeBorder};--type-chip-color:${typeInfo.badgeColor};`;

    const sanitizedDescription = sanitizeWorkItemHtml(descriptionRaw);
    const descriptionMarkup = sanitizedDescription.trim()
        ? sanitizedDescription
        : '<p class="description__empty">This work item does not have a description yet.</p>';

    const remainingChip = remaining !== undefined
        ? `<span class="chip chip--quiet">${escapeHtml(remainingDisplay)} remaining</span>`
        : '';
    const typeChip = `<span class="chip chip--type">${workItemType}</span>`;

    const commentItems = discussion
        .map(comment => {
            const author = escapeHtml(comment.createdBy?.displayName || 'Unknown');
            const formattedDate = comment.createdDate
                ? formatDiscussionTimestamp(comment.createdDate)
                : '';
            const sanitizedComment = sanitizeWorkItemHtml(comment.text || '');
            const commentContent = sanitizedComment.trim()
                ? sanitizedComment
                : '<p class="discussion__comment-empty">No additional details.</p>';

            const actionLabel = comment.source === 'history' ? 'Updated' : 'Commented';
            const timestampText = formattedDate
                ? `${actionLabel} ${formattedDate}`
                : actionLabel;
            const timestampMarkup = `<span class="discussion__timestamp">${escapeHtml(timestampText)}</span>`;

            return `<article class="discussion__item">
                <header class="discussion__item-header">
                    <span class="discussion__author">${author}</span>
                    ${timestampMarkup}
                </header>
                <div class="discussion__body">${commentContent}</div>
            </article>`;
        });
    const discussionMarkup = commentItems.length
        ? `<div class="discussion__list">${commentItems.join('')}</div>`
        : '<p class="discussion__empty">No discussion has been started yet.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSource} 'unsafe-inline'; img-src ${styleSource} https: data:;" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Work Item ${workItem.id}</title>
    <style>
        :root {
            color-scheme: light;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            --accent-primary: #0078d4;
            --accent-secondary: #4f6bed;
            --accent-muted: #eff6fc;
            --neutral-foreground: #201f1e;
            --neutral-muted: #605e5c;
            --surface: #ffffff;
            --surface-muted: #f3f2f1;
            --border-subtle: #d0d7de;
            --shadow-elevated: 0 10px 28px rgba(15, 23, 42, 0.12);
            --type-primary: #0078d4;
            --type-secondary: #4f6bed;
            --type-muted: rgba(0, 120, 212, 0.08);
            --type-chip-bg: rgba(0, 120, 212, 0.12);
            --type-chip-border: rgba(0, 120, 212, 0.25);
            --type-chip-color: #004578;
        }
        body {
            margin: 0;
            background: var(--vscode-editor-background, #f5f7fa);
            color: var(--vscode-editor-foreground, var(--neutral-foreground));
        }
        .container {
            max-width: 960px;
            margin: 0 auto;
            padding: 32px 32px 48px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .hero {
            position: relative;
            border-radius: 16px;
            padding: 28px 32px;
            background: var(--surface);
            border: 1px solid var(--vscode-editorGroup-border, var(--border-subtle));
            box-shadow: var(--shadow-elevated);
        }
        .hero::before {
            content: '';
            position: absolute;
            top: -1px;
            left: -1px;
            right: -1px;
            height: 6px;
            background: linear-gradient(90deg, var(--type-primary, var(--accent-primary)), var(--type-secondary, var(--accent-secondary)));
            border-radius: 16px 16px 0 0;
        }
        .hero__chips {
            position: relative;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 18px;
            z-index: 1;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 6px 14px;
            border-radius: 999px;
            font-size: 0.78rem;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            background: rgba(255, 255, 255, 0.98);
            color: var(--neutral-foreground);
            border: 1px solid rgba(15, 23, 42, 0.12);
            box-shadow: none;
            font-weight: 600;
        }
        .chip--type {
            background: var(--type-chip-bg, rgba(0, 120, 212, 0.24));
            color: var(--type-chip-color, #00345a);
            border-color: var(--type-chip-border, rgba(0, 120, 212, 0.45));
        }
        .chip--quiet {
            background: rgba(32, 31, 30, 0.08);
            color: rgba(32, 31, 30, 0.9);
            border-color: rgba(32, 31, 30, 0.2);
        }
        .hero__title {
            position: relative;
            margin: 0 0 12px;
            font-size: clamp(1.8rem, 2.6vw, 2.35rem);
            line-height: 1.25;
            color: var(--neutral-foreground);
        }
        .hero__meta {
            position: relative;
            margin: 0;
            font-size: 0.95rem;
            color: var(--neutral-muted);
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
        }
        .summary__card {
            background: var(--surface);
            border: 1px solid var(--border-subtle);
            border-radius: 14px;
            padding: 18px 20px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
        }
        .summary__label {
            font-size: 0.72rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(32, 31, 30, 0.6);
        }
        .summary__value {
            font-size: 1.05rem;
            font-weight: 600;
            color: var(--neutral-foreground);
        }
        .summary__value--state {
            color: var(--accent-primary);
        }
        .summary__value--type {
            color: var(--type-primary, var(--neutral-foreground));
        }
        .summary__card--type {
            border-top: 3px solid var(--type-primary, var(--border-subtle));
        }
        .summary__hint {
            font-size: 0.8rem;
            color: rgba(32, 31, 30, 0.55);
        }
        .description {
            background: var(--surface);
            border: 1px solid var(--border-subtle);
            border-radius: 14px;
            padding: 24px 28px;
            box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
            color: rgba(32, 31, 30, 0.88);
            line-height: 1.7;
        }
        .description > *:not(:last-child) {
            margin-bottom: 12px;
        }
        .description h2 {
            margin-top: 0;
            font-size: 1.2rem;
            margin-bottom: 12px;
            color: var(--neutral-foreground);
        }
        .description p,
        .description li,
        .description span,
        .description div,
        .description code,
        .description pre,
        .description strong,
        .description em {
            margin: 0;
            font-size: 0.98rem;
            color: inherit;
        }
        .description ul,
        .description ol {
            margin: 0 0 12px 1.4rem;
            padding: 0;
            color: inherit;
        }
        .description li {
            margin-bottom: 8px;
        }
        .description strong {
            font-weight: 600;
            color: inherit;
        }
        .description code,
        .description pre {
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
            background: rgba(15, 23, 42, 0.06);
            border-radius: 6px;
            padding: 2px 6px;
        }
        .description pre {
            padding: 12px 14px;
            overflow-x: auto;
        }
        .description blockquote {
            margin: 0 0 16px;
            padding-left: 16px;
            border-left: 4px solid rgba(15, 23, 42, 0.18);
            color: inherit;
        }
        .description a {
            color: var(--type-primary, var(--accent-primary));
            text-decoration: none;
            font-weight: 600;
        }
        .description a:hover {
            text-decoration: underline;
        }
        .description__empty {
            font-style: italic;
            color: rgba(32, 31, 30, 0.55);
        }
        .discussion {
            background: var(--surface);
            border: 1px solid var(--border-subtle);
            border-radius: 14px;
            padding: 24px 28px;
            box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
        }
        .discussion h2 {
            margin-top: 0;
            margin-bottom: 16px;
            font-size: 1.2rem;
            color: var(--neutral-foreground);
        }
        .discussion__list {
            display: flex;
            flex-direction: column;
            gap: 18px;
            margin: 0;
        }
        .discussion__item {
            border-top: 1px solid var(--border-subtle);
            padding-top: 18px;
        }
        .discussion__item:first-child {
            border-top: none;
            padding-top: 0;
        }
        .discussion__item-header {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: baseline;
            margin-bottom: 8px;
        }
        .discussion__author {
            font-weight: 600;
            color: var(--neutral-foreground);
        }
        .discussion__timestamp {
            font-size: 0.85rem;
            color: rgba(32, 31, 30, 0.6);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .discussion__body {
            font-size: 0.95rem;
            line-height: 1.6;
            color: rgba(32, 31, 30, 0.88);
        }
        .discussion__body p {
            margin: 0 0 0.85em;
        }
        .discussion__body p:last-child {
            margin-bottom: 0;
        }
        .discussion__empty,
        .discussion__comment-empty {
            margin: 0;
            font-style: italic;
            color: rgba(32, 31, 30, 0.55);
        }
        .hero.state-active { --accent-primary: #0078d4; --accent-secondary: #4f6bed; }
        .hero.state-new { --accent-primary: #038387; --accent-secondary: #00b7c3; }
        .hero.state-resolved,
        .hero.state-closed,
        .hero.state-done { --accent-primary: #107c10; --accent-secondary: #00b050; }
        .hero.state-in-progress,
        .hero.state-committed { --accent-primary: #d83b01; --accent-secondary: #ff8c00; }
        .hero.state-unknown { --accent-primary: #8a8886; --accent-secondary: #605e5c; }
        @media (max-width: 720px) {
            .container {
                padding: 24px 20px 40px;
            }
            .hero {
                padding: 24px;
            }
            .summary {
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            }
            .description {
                padding: 20px 22px;
            }
            .discussion {
                padding: 20px 22px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="hero state-${stateSlug} type-${typeSlug}" style="${heroStyle}">
            <div class="hero__chips">
                ${typeChip}
                <span class="chip chip--quiet">#${workItem.id}</span>
                ${remainingChip}
            </div>
            <h1 class="hero__title">${title}</h1>
            <p class="hero__meta">${projectLabel} • ${organizationLabel}</p>
        </header>
        <section class="summary">
            <div class="summary__card">
                <span class="summary__label">State</span>
                <span class="summary__value summary__value--state">${state}</span>
            </div>
            <div class="summary__card">
                <span class="summary__label">Remaining Work</span>
                <span class="summary__value">${escapeHtml(remainingDisplay)}</span>
            </div>
            <div class="summary__card summary__card--type">
                <span class="summary__label">Type</span>
                <span class="summary__value summary__value--type">${workItemType}</span>
            </div>
            <div class="summary__card">
                <span class="summary__label">Project</span>
                <span class="summary__value">${projectLabel}</span>
                <span class="summary__hint">${organizationLabel}</span>
            </div>
        </section>
        <section class="description">
            <h2>Description</h2>
            ${descriptionMarkup}
        </section>
        <section class="discussion">
            <h2>Discussion</h2>
            ${discussionMarkup}
        </section>
    </div>
</body>
</html>`;
}

function getLoadingHtml(webview: vscode.Webview): string {
    const styleSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loading Azure DevOps Work Items</title>
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background, #eff2f7);
            color: var(--vscode-editor-foreground, #202124);
        }
        .spinner {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: 4px solid rgba(0, 0, 0, 0.12);
            border-top-color: rgba(0, 0, 0, 0.45);
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="spinner" aria-label="Loading work items" role="status"></div>
</body>
</html>`;
}

function getInformationalHtml(webview: vscode.Webview, title: string, message: string): string {
    const styleSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            text-align: center;
            padding: 32px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background, #f4f6f8);
            color: var(--vscode-editor-foreground, #1f2933);
        }
        h2 {
            margin-bottom: 12px;
        }
        p {
            color: var(--vscode-descriptionForeground, #52606d);
            max-width: 420px;
        }
    </style>
</head>
<body>
    <main>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
    </main>
</body>
</html>`;
}

type WorkItemDiscussionEntry = {
    id: string;
    text: string;
    createdBy: {
        displayName: string;
        imageUrl?: string;
    };
    createdDate: string;
    source: 'comment' | 'history';
};

function sanitizeWorkItemHtml(value: string): string {
    if (!value) {
        return '';
    }

    const withoutDangerousTags = value
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');

    const allowedTags = new Set([
        'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'a', 'code', 'pre',
        'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote', 'span', 'div',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr'
    ]);

    const selfClosingTags = new Set(['br', 'hr']);

    return withoutDangerousTags.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName, attrsPart) => {
        const tag = tagName.toLowerCase();

        if (!allowedTags.has(tag)) {
            return '';
        }

        if (match.startsWith('</')) {
            return `</${tag}>`;
        }

        const safeAttrs: string[] = [];

        if (attrsPart && attrsPart.trim()) {
            attrsPart.replace(/([a-z0-9:-]+)\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, (_attrMatch: string, attrName: string, attrValue: string) => {
                const name = attrName.toLowerCase();
                let attrVal = attrValue.trim().replace(/^['"]|['"]$/g, '');

                if (!attrVal) {
                    return '';
                }

                if (name.startsWith('on') || name === 'style') {
                    return '';
                }

                if (tag === 'a' && name === 'href') {
                    if (/^javascript:/i.test(attrVal)) {
                        return '';
                    }
                    safeAttrs.push(`href="${escapeHtml(attrVal)}"`);
                    return '';
                }

                if (tag === 'a' && name === 'title') {
                    safeAttrs.push(`title="${escapeHtml(attrVal)}"`);
                    return '';
                }

                if ((tag === 'td' || tag === 'th') && (name === 'colspan' || name === 'rowspan')) {
                    if (/^[0-9]+$/.test(attrVal)) {
                        safeAttrs.push(`${name}="${attrVal}"`);
                    }
                    return '';
                }

                if ((tag === 'span' || tag === 'div') && name === 'class') {
                    safeAttrs.push(`class="${escapeHtml(attrVal)}"`);
                    return '';
                }

                return '';
            });
        }

        const attrsString = safeAttrs.length ? ` ${safeAttrs.join(' ')}` : '';

        if (selfClosingTags.has(tag) || /\/\s*>$/.test(match)) {
            return `<${tag}${attrsString} />`;
        }

        return `<${tag}${attrsString}>`;
    });
}

type WorkItemTypeStyle = {
    slug: string;
    label: string;
    heroPrimary: string;
    heroSecondary: string;
    heroTint: string;
    badgeBackground: string;
    badgeBorder: string;
    badgeColor: string;
};

function getWorkItemTypeStyle(typeRaw: string): WorkItemTypeStyle {
    const label = typeRaw?.trim() ? typeRaw.trim() : 'Work Item';
    const normalized = label.toLowerCase();

    switch (normalized) {
        case 'user story':
        case 'story':
        case 'product backlog item':
            return {
                slug: 'user-story',
                label,
                heroPrimary: '#0078d4',
                heroSecondary: '#4f6bed',
                heroTint: 'rgba(0, 120, 212, 0.1)',
                badgeBackground: 'rgba(0, 120, 212, 0.18)',
                badgeBorder: 'rgba(0, 120, 212, 0.4)',
                badgeColor: '#003e6b'
            };
        case 'feature':
            return {
                slug: 'feature',
                label,
                heroPrimary: '#5c2d91',
                heroSecondary: '#8764d1',
                heroTint: 'rgba(92, 45, 145, 0.14)',
                badgeBackground: 'rgba(92, 45, 145, 0.18)',
                badgeBorder: 'rgba(92, 45, 145, 0.35)',
                badgeColor: '#402062'
            };
        case 'epic':
            return {
                slug: 'epic',
                label,
                heroPrimary: '#ca5010',
                heroSecondary: '#ff8c00',
                heroTint: 'rgba(202, 80, 16, 0.16)',
                badgeBackground: 'rgba(202, 80, 16, 0.18)',
                badgeBorder: 'rgba(202, 80, 16, 0.35)',
                badgeColor: '#773510'
            };
        case 'task':
            return {
                slug: 'task',
                label,
                heroPrimary: '#107c10',
                heroSecondary: '#0b6a0b',
                heroTint: 'rgba(16, 124, 16, 0.12)',
                badgeBackground: 'rgba(16, 124, 16, 0.18)',
                badgeBorder: 'rgba(16, 124, 16, 0.4)',
                badgeColor: '#0b5010'
            };
        case 'bug':
            return {
                slug: 'bug',
                label,
                heroPrimary: '#d13438',
                heroSecondary: '#a4262c',
                heroTint: 'rgba(209, 52, 56, 0.14)',
                badgeBackground: 'rgba(209, 52, 56, 0.18)',
                badgeBorder: 'rgba(209, 52, 56, 0.4)',
                badgeColor: '#7f1b1e'
            };
        case 'issue':
            return {
                slug: 'issue',
                label,
                heroPrimary: '#c19c00',
                heroSecondary: '#ffaa44',
                heroTint: 'rgba(193, 156, 0, 0.16)',
                badgeBackground: 'rgba(193, 156, 0, 0.2)',
                badgeBorder: 'rgba(193, 156, 0, 0.38)',
                badgeColor: '#5c4700'
            };
        case 'test case':
        case 'test':
            return {
                slug: 'test',
                label,
                heroPrimary: '#038387',
                heroSecondary: '#00b7c3',
                heroTint: 'rgba(3, 131, 135, 0.16)',
                badgeBackground: 'rgba(3, 131, 135, 0.2)',
                badgeBorder: 'rgba(3, 131, 135, 0.38)',
                badgeColor: '#025357'
            };
        default:
            return {
                slug: normalized.replace(/[^a-z0-9]+/g, '-') || 'work-item',
                label,
                heroPrimary: '#8a8886',
                heroSecondary: '#605e5c',
                heroTint: 'rgba(96, 94, 92, 0.12)',
                badgeBackground: 'rgba(138, 136, 134, 0.2)',
                badgeBorder: 'rgba(138, 136, 134, 0.4)',
                badgeColor: '#3a3a39'
            };
    }
}

function stripHtml(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
    if (!value || value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function deactivate() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = undefined;
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
