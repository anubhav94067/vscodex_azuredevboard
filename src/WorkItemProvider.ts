import * as vscode from 'vscode';
import axios from 'axios';

// Interfaces for Azure DevOps API responses
interface WiqlResponse {
    workItems: { id: number }[];
}

interface AzDoWorkItem {
    id: number;
    fields: {
        'System.Title': string;
        'System.State': string;
        'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
    };
}

interface WorkItemDetailsResponse {
    value: AzDoWorkItem[];
}

export class WorkItemsProvider implements vscode.TreeDataProvider<WorkItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkItem | undefined | null | void> = new vscode.EventEmitter<WorkItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkItem): Promise<WorkItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const organization = this.context.globalState.get<string>('organization');
        const project = this.context.globalState.get<string>('project');
        const pat = this.context.globalState.get<string>('personalAccessToken');
        const queryId = this.context.globalState.get<string>('queryId');
        
        if (!organization || !project || !pat || !queryId) {
            // No error message needed here, the activation function handles the initial prompt.
            return Promise.resolve([]);
        }

        try {
            const authHeader = `Basic ${Buffer.from(':' + pat).toString('base64')}`;
            
            interface QueryResponse {
                wiql: string;
            }

            const queryUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/queries/${queryId}?api-version=6.0&$expand=wiql`;
            const queryResponse = await axios.get<QueryResponse>(queryUrl, { headers: { 'Authorization': authHeader } });
            const wiqlQuery = queryResponse.data.wiql;
            
            const wiqlUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=6.0`;
            const wiqlResponse = await axios.post<WiqlResponse>(wiqlUrl, { query: wiqlQuery }, { headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } });

            const workItemRefs = wiqlResponse.data.workItems;
            if (!workItemRefs || workItemRefs.length === 0) {
                return Promise.resolve([new WorkItem({ id: 0, fields: { 'System.Title': 'No work items found for the given query.', 'System.State': '' } })]);
            }

            const workItemIds = workItemRefs.map(item => item.id);
            
            const chunkedIds = [];
            for (let i = 0; i < workItemIds.length; i += 200) {
                chunkedIds.push(workItemIds.slice(i, i + 200));
            }

            let allWorkItems: AzDoWorkItem[] = [];
            for (const chunk of chunkedIds) {
                const detailsUrl = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems?ids=${chunk.join(',')}&fields=System.Title,System.State,Microsoft.VSTS.Scheduling.RemainingWork&api-version=6.0`;
                const detailsResponse = await axios.get<WorkItemDetailsResponse>(detailsUrl, { headers: { 'Authorization': authHeader } });
                if (detailsResponse.data && detailsResponse.data.value) {
                    allWorkItems = allWorkItems.concat(detailsResponse.data.value);
                }
            }

            if (allWorkItems.length === 0) {
                return Promise.resolve([new WorkItem({ id: 0, fields: { 'System.Title': 'Could not fetch details for work items.', 'System.State': '' } })]);
            }

            return allWorkItems.map(item => new WorkItem(item, this.context));

        } catch (error: any) {
            console.error('Error fetching work items:', error);
            
            if (error.response) {
                switch (error.response.status) {
                    case 401:
                        vscode.window.showErrorMessage('Authentication failed. Please check your Personal Access Token.');
                        break;
                    case 403:
                        vscode.window.showErrorMessage('Access denied. Please check your permissions.');
                        break;
                    case 404:
                        vscode.window.showErrorMessage('Resource not found. Please check your Organization, Project, and Query ID.');
                        break;
                    default:
                        vscode.window.showErrorMessage(`Failed to fetch work items: ${error.response.status} ${error.response.statusText}`);
                }
            } else if (error.request) {
                vscode.window.showErrorMessage('Network error. Please check your internet connection.');
            } else {
                vscode.window.showErrorMessage('Unexpected error: ' + error.message);
            }
            
            return Promise.resolve([]);
        }
    }
}

export class WorkItem extends vscode.TreeItem {
    constructor(
        public readonly workItemData: AzDoWorkItem,
        private readonly context?: vscode.ExtensionContext
    ) {
        if (workItemData.id === 0) {
            super(workItemData.fields['System.Title'], vscode.TreeItemCollapsibleState.None);
            this.id = 'message';
            this.contextValue = 'message';
        } else {
            const activeWorkItemId = context?.globalState.get('activeWorkItemId');
            const isTiming = activeWorkItemId === workItemData.id.toString();
            const remainingWork = workItemData.fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
            const isCompleted = remainingWork === 0;

            let label = `${workItemData.id}: ${workItemData.fields['System.Title']}`;
            if (isTiming) {
                // The TreeItemLabel interface is not directly exposed, but this structure works.
                // We can't color the whole label, but we can color parts of it this way.
            }

            super(label, vscode.TreeItemCollapsibleState.None);
            this.id = workItemData.id.toString();
            this.tooltip = `${this.label}\nState: ${workItemData.fields['System.State']}\nRemaining Work: ${remainingWork}h`;
            this.description = `State: ${workItemData.fields['System.State']}${isTiming ? ' (Timing)' : ''}${remainingWork > 0 ? ` (${remainingWork}h)` : ' (Ready to Close)'}`;

            if (isTiming) {
                this.contextValue = 'workItem-active';
                const greenColor = new vscode.ThemeColor('charts.green');
                this.iconPath = new vscode.ThemeIcon('watch', greenColor);
            } else if (isCompleted && (workItemData.fields['System.State'] === 'Active' || workItemData.fields['System.State'] === 'Resolved')) {
                // Show close option only for Active or Resolved items with no remaining work
                this.contextValue = 'workItem-completed';
                this.iconPath = new vscode.ThemeIcon('check-all');
            } else {
                this.contextValue = 'workItem';
                const state = workItemData.fields['System.State'];
                if (state === 'Active') {
                    this.iconPath = new vscode.ThemeIcon('zap');
                } else if (state === 'New') {
                    this.iconPath = new vscode.ThemeIcon('lightbulb');
                } else if (state === 'Resolved' || state === 'Closed' || state === 'Done') {
                    this.iconPath = new vscode.ThemeIcon('check');
                } else {
                    this.iconPath = new vscode.ThemeIcon('circle-outline');
                }
            }
        }
    }
}
