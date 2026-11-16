
export function smartTruncate(text: string, maxLines: number): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) {
        return text;
    }

    const headLimit = Math.floor(maxLines * 0.2);
    const tailLimit = Math.floor(maxLines * 0.3);
    const criticalKeywords = ["Error", "Exception", "Fatal", "Warning"];

    const output: string[] = [];
    let skippedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const isCritical = criticalKeywords.some(keyword => line.includes(keyword));
        const isContext = i < headLimit || i >= (lines.length - tailLimit);
        
        if (isCritical || isContext) {
            output.push(line);
        } else {
            skippedCount++;
        }
    }
    
    if (skippedCount > 0) {
        
        
        const insertIndex = Math.min(headLimit, output.length);
        output.splice(insertIndex, 0, `... [${skippedCount} lines omitted] ...`);
    }

    return output.join('\n');
}
