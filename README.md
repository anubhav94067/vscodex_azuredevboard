# Azure DevOps Time Tracker

A comprehensive VS Code extension for tracking time on Azure DevOps work items with intelligent state management.

## 🚀 Features

### ⏱️ **Time Tracking**
- Start/stop timers directly from the VS Code sidebar
- Real-time timer display in the status bar
- Visual indicators for active timers (green watch icon)

### 📊 **Smart State Management**
- **Auto-Active**: Work items automatically transition to "Active" state when effort is logged
- **Smart Closing**: Close work items when remaining work reaches zero
- **State-Aware UI**: Context menus and icons adapt based on work item state

### 💻 **Seamless Integration**
- Native VS Code tree view for Azure DevOps work items
- Direct time logging with editable hours and comments
- Browser integration for detailed work item editing
- Real-time tree view updates after operations

### 🎯 **Intelligent Workflow**
1. **Configure** → Set up Azure DevOps connection
2. **Start Timer** → Begin tracking time on work items
3. **Log Time** → Automatically updates completed/remaining work and sets state to Active
4. **Close Items** → When remaining work = 0, easily close completed items

## 📋 Requirements

- VS Code 1.104.0 or higher
- Azure DevOps account with appropriate permissions
- Personal Access Token (PAT) with Work Items (read & write) permissions

## ⚙️ Configuration

This extension requires the following settings:

- `azure-devops-time-tracker.organization`: Your Azure DevOps organization name
- `azure-devops-time-tracker.project`: Your Azure DevOps project name  
- `azure-devops-time-tracker.personalAccessToken`: Your Personal Access Token
- `azure-devops-time-tracker.queryId`: ID of your saved Azure DevOps query

### Setting up your Personal Access Token:
1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Create new token with **Work Items (Read & Write)** permissions
3. Copy the token and paste it in the extension configuration

## 🔧 Usage

1. **First Setup**: Use Command Palette (`Ctrl+Shift+P`) → "Configure Azure DevOps Settings"
2. **View Work Items**: Check the "Azure DevOps" section in the Explorer sidebar
3. **Start Tracking**: Right-click a work item → "Start Timer"
4. **Log Time**: Stop timer and choose to log time directly or in browser
5. **Close Items**: When remaining work = 0, use the close button (✓ icon)

## 🎨 Visual Indicators

| Icon | Meaning |
|------|---------|
| 💡 | New work item |
| ⚡ | Active work item |
| ⏱️ (green) | Timer running |
| ✅ | Completed/Closed work item |
| ☑️☑️ | Ready to close (0 remaining work) |

## 🌟 Smart Features

### State Management
- Work items automatically become "Active" when you log time
- Visual feedback shows state changes in success messages
- History tracking includes state change information

### Time Logging
- Pre-filled with calculated time from timer
- Editable hours before logging
- Optional comments with smart placeholders
- Updates both completed and remaining work fields

### Conditional UI
- Close button only appears when remaining work = 0
- Different context menus based on work item state
- Smart tooltips showing remaining work information

## 🐛 Known Issues

- Azure DevOps webview embedding blocked by X-Frame-Options (opens in external browser)
- Timer state persists during VS Code restarts (by design)

## 📝 Release Notes

### 0.0.1 - Initial Release

**Features:**
- ✅ Complete time tracking workflow
- ✅ Smart state management (Auto-Active, Smart Close)
- ✅ Real-time UI updates
- ✅ Editable time logging
- ✅ Azure DevOps API integration
- ✅ State-aware visual indicators

**Technical:**
- TypeScript implementation with full type safety
- Axios for reliable HTTP requests
- VS Code Extension API best practices
- Error handling and user feedback

## 🤝 Contributing

This is an open-source project. Feel free to:
- Report issues
- Submit feature requests
- Contribute code improvements

## 📄 License

This project is licensed under the MIT License.

---

**Enjoy efficient time tracking right in VS Code!** 🎉
