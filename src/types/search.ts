import * as vscode from 'vscode';

export enum SearchItemType {
    File = 'file',
    Class = 'class',
    Method = 'method',
    Function = 'function',
    Variable = 'variable',
    Interface = 'interface',
    Enum = 'enum',
    Namespace = 'namespace'
}

export interface SearchItem extends vscode.QuickPickItem {
    type: SearchItemType;
    uri: vscode.Uri;
    range?: vscode.Range;
    containerName?: string;
    score?: number;
}

export interface SearchProvider {
    search(query: string): Promise<SearchItem[]>;
}