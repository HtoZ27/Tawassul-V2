export declare function checkSource(relPath: string, source: string): string[];
export declare function checkFile(file: string): string[];
export declare function checkMarkdown(relPath: string, source: string): string[];
export declare function checkShippedMarkdown(): { files: number; errors: string[] };
export declare function checkAll(): { files: number; errors: string[] };
