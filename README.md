# QA Reporter Chrome Extension

A production-grade Chrome Extension (Manifest V3) for internal QA teams to report UI issues directly from any web page without leaving the application.

## Features

### Phase 1 MVP

- **Element Selection Mode**: Click to select any element on a page
- **Visual Highlighting**: Hover highlighting with overlay border
- **Issue Reporting Modal**: Draggable modal for entering issue details
- **Local Storage**: All issues stored locally in extension storage
- **Export Functionality**: Export all issues as JSON file
- **Robust Selector Generation**: CSS selectors and XPath for React/Vue/Angular apps
- **Data Attribute Capture**: Captures `data-feature`, `data-component`, `data-module` attributes

## Installation

### Developer Mode Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Navigate to the `src` folder in this project
5. Select it and click **Select Folder**
6. The extension icon will appear in your toolbar

## Usage

### Basic Workflow

1. Click the extension icon in the Chrome toolbar
2. Click **Start Reporting** to enter element selection mode
3. Hover over elements on the page to highlight them
4. Click on the element you want to report
5. Fill in issue details:
   - **Issue Title** (required)
   - **Issue Description**
   - **Severity** (Low, Medium, High, Critical)
6. Click **Save Issue**
7. The issue is stored locally

### Export Issues

1. Click the extension icon
2. Click **Export Issues**
3. A JSON file will be downloaded (`qa-issues-YYYY-MM-DD.json`)

### Clear Issues

1. Click the extension icon
2. Click **Clear All**
3. Confirm the action

## Issue Data Structure

Each issue is saved with the following structure:

```json
{
  "id": "uuid-v4",
  "title": "Issue title",
  "description": "Detailed description",
  "severity": "High",
  "url": "https://example.com/page",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "element": {
    "tagName": "BUTTON",
    "id": "submit-btn",
    "classList": ["btn", "primary"],
    "textContent": "Submit",
    "cssSelector": "#submit-btn",
    "xpath": "/html/body/div[1]/form/button",
    "dataAttributes": {
      "data-feature": "Employee",
      "data-component": "EmployeeGrid"
    }
  }
}
```

## Architecture

### Folder Structure

```
src/
├── manifest.json           # Extension manifest (Manifest V3)
├── background/
│   └── service-worker.js    # Background service worker
├── content/
│   ├── content.js          # Main content script (self-contained)
│   └── styles.css          # Styles for highlighting and modal
├── popup/
│   ├── popup.html          # Extension popup HTML
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Key Components

1. **Background Service Worker**: Handles storage operations, exports, and message passing
2. **Content Script**: Manages element selection, highlighting, and modal UI
3. **Popup**: User interface for controlling the extension

### Selector Generation Strategy

The extension uses a prioritized approach for generating robust selectors:

1. **ID selector** (if unique and not auto-generated)
2. **Data attributes** (`data-testid`, `data-cy`, `data-qa`, etc.)
3. **Stable class combinations** (filters out React/CSS Modules hashes)
4. **Attribute selectors** (`name`, `type`, `placeholder`, `aria-label`, etc.)
5. **Structural selectors** (nth-of-type paths)

## Framework Compatibility

Works correctly on:

- React (Create React App, Next.js)
- Vue.js
- Angular
- Vanilla JavaScript applications

The extension does not rely on framework-specific internals.

## Future Extensibility

The architecture is designed to easily add:

- Screenshot capture
- Azure DevOps ticket creation
- Jira integration
- Console error collection
- Network request capture
- Screen recording
- Annotation tools

## Technical Details

- **Manifest Version**: V3
- **Permissions**: `storage`, `activeTab`, `downloads`
- **No External Dependencies**: Pure vanilla JavaScript
- **ES6+**: Modern JavaScript features
- **Clean Architecture**: Separation of concerns, modular design

## Development

### Building

No build process required - the extension runs directly from source files.

### Testing

1. Load the extension in Chrome Developer Mode
2. Navigate to any web page
3. Test the complete workflow:
   - Start/Stop reporting
   - Element selection
   - Issue saving
   - Export/Clear operations

## License

Internal tool for QA teams.

groscl.ltd@gmail.com
Test1234!
