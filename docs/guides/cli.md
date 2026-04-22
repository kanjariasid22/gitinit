# Version 1.0.0 - Enhanced Visual Readability

## What This Feature Does
This update marks the first major stable release (version 1.0.0) of the tool. The primary focus of this release is a significant visual overhaul of the Command Line Interface (CLI). By introducing color-coded text, the tool now makes it much easier to distinguish between different types of information when managing your projects.

The following commands now feature colorized output:
*   **Log:** History entries are easier to scan.
*   **Status:** Current project states and changes are highlighted.
*   **Branch:** Active and inactive branches are clearly differentiated.
*   **Merge:** Conflicts and successful merges are more distinct.
*   **Diff:** Comparisons between file versions are more readable.

## How To Use It
You do not need to change how you use the tool to see these improvements. Simply run your standard commands (such as `status` or `log`) in your terminal. The colors will appear automatically based on the command you are running. 

For example, when you check the status of your work, the tool will now use specific colors to highlight modified files or pending changes, allowing you to process the information at a glance.

## Important Notes
*   **Terminal Compatibility:** The colorized output depends on your terminal's ability to display colors. Most modern terminals (like those on macOS, Linux, and Windows 10/11) will support this natively.
*   **No Manual Toggle:** Currently, there is no built-in command-line flag (such as `--no-color`) to disable the colorized output. If you are using this tool in an older environment that does not support color, the text may display with extra characters or remain plain.
*   **First Stable Release:** Version 1.0.0 signals that the tool has reached its first major milestone for stability and is ready for general use.