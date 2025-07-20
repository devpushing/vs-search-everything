# Search Everything for VS Code

Fast, IntelliJ-style "Search Everything" functionality for Visual Studio Code. Search through files and symbols instantly, even in massive codebases with millions of files.

## Features

- 🚀 **Lightning Fast**: Uses trigram-based indexing for instant search results
- 🔍 **IntelliJ-Style Search**: Familiar search experience for IntelliJ users
- 📁 **Unified Search**: Search files and symbols in one place
- 🎯 **Smart Matching**: 
  - CamelCase matching (e.g., "gUN" matches "getUserName")
  - Fuzzy matching with typo tolerance
  - Abbreviation matching
- 💾 **Handles Massive Codebases**: Efficiently indexes and searches millions of files
- ⚡ **Real-time Results**: See results as you type
- 🔧 **Zero Configuration**: Works out of the box

## Usage

1. Press `Ctrl+Shift+F` (Windows/Linux) or `Cmd+Shift+F` (macOS)
2. Start typing to search for files or symbols
3. Use arrow keys to navigate results
4. Press Enter to open the selected file or jump to symbol

### Search Examples

- `userctrl` → finds `UserController.ts`
- `gUN` → finds `getUserName()` method
- `index.ts` → finds all files named index.ts
- `handleReq` → finds `handleRequest()` function

## Commands

- **Search Everything: Search** - Open the search dialog
- **Search Everything: Reset Index** - Rebuild the search index

## Configuration

Customize the extension through VS Code settings:

- `searchEverything.includeSymbols`: Include symbols in search results (default: `true`)
- `searchEverything.includeFiles`: Include files in search results (default: `true`)
- `searchEverything.maxResults`: Maximum number of results to display (default: `50`)
- `searchEverything.excludePatterns`: Glob patterns to exclude from search (default: `["**/node_modules/**", "**/.git/**"]`)
- `searchEverything.trigramCaseSensitive`: Enable case-sensitive matching (default: `false`)
- `searchEverything.trigramMinLength`: Minimum query length for trigram search (default: `3`)
- `searchEverything.enableCamelCaseMatching`: Enable CamelCase matching (default: `true`)
- `searchEverything.trigramBatchSize`: Number of operations before committing to database (default: `10000`)
- `searchEverything.storageType`: Storage backend - "sqlite" (persistent) or "memory" (faster but volatile) (default: `sqlite`)
- `searchEverything.debugMode`: Enable debug logging (default: `false`)

## How It Works

This extension uses trigram indexing (3-character sequences) similar to IntelliJ IDEA's "Search Everything" feature. This approach provides:

- Deterministic, fast search results
- Low memory footprint
- Efficient indexing of large codebases
- Support for fuzzy matching and typos

The index is stored using SQLite (via WebAssembly) and automatically updates as files change.

## Requirements

- VS Code 1.74.0 or higher
- Node.js environment (comes with VS Code)

## Known Issues

- Initial indexing of very large projects may take a few minutes
- Symbol search requires language extensions that provide symbol information

## Release Notes

### 0.0.1

- Initial release
- Trigram-based file and symbol search
- CamelCase and abbreviation matching
- Support for massive codebases

## Contributing

Found a bug or have a feature request? Please open an issue on [GitHub](https://github.com/your-username/vs-search-everything).

## License

MIT