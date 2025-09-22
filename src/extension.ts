import * as vscode from 'vscode';
import { WorkItemsProvider, WorkItem } from './WorkItemProvider';

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

function getWebviewContent(url: string, workItemId: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Work Item ${workItemId}</title>
    <style>
        body, html {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
        }
        iframe {
            width: 100%;
            height: 100vh;
            border: none;
        }
        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="loading">Loading Work Item ${workItemId}...</div>
    <iframe src="${url}" onload="document.querySelector('.loading').style.display='none'"></iframe>
</body>
</html>`;
}

export function deactivate() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    if(statusBarItem) {
        statusBarItem.dispose();
    }
}
