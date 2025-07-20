export class TrigramUtils {
    private static readonly MIN_LENGTH = 3;

    /**
     * Generate trigrams from a text string
     * Example: "search" -> ["sea", "ear", "arc", "rch"]
     */
    static generateTrigrams(text: string, caseSensitive: boolean = false): string[] {
        if (!text || text.length < this.MIN_LENGTH) {
            return [];
        }

        const processedText = caseSensitive ? text : text.toLowerCase();
        const trigrams = new Set<string>();

        for (let i = 0; i <= processedText.length - this.MIN_LENGTH; i++) {
            const trigram = processedText.substring(i, i + this.MIN_LENGTH);
            // Only add if it contains at least one alphanumeric character
            if (/[a-zA-Z0-9]/.test(trigram)) {
                trigrams.add(trigram);
            }
        }

        return Array.from(trigrams);
    }

    /**
     * Generate trigrams with position information
     */
    static generateTrigramsWithPositions(
        text: string, 
        caseSensitive: boolean = false
    ): Array<{ trigram: string; position: number }> {
        if (!text || text.length < this.MIN_LENGTH) {
            return [];
        }

        const processedText = caseSensitive ? text : text.toLowerCase();
        const results: Array<{ trigram: string; position: number }> = [];

        for (let i = 0; i <= processedText.length - this.MIN_LENGTH; i++) {
            const trigram = processedText.substring(i, i + this.MIN_LENGTH);
            if (/[a-zA-Z0-9]/.test(trigram)) {
                results.push({ trigram, position: i });
            }
        }

        return results;
    }

    /**
     * Extract CamelCase tokens from a string
     * Example: "getUserName" -> ["get", "User", "Name"]
     * Example: "HTTPSConnection" -> ["HTTPS", "Connection"]
     * Example: "snake_case_var" -> ["snake", "case", "var"]
     */
    static extractCamelCaseTokens(text: string): string[] {
        const tokens: string[] = [];
        
        // Handle snake_case and kebab-case by splitting on separators
        const parts = text.split(/[_\-\s]+/);
        
        for (const part of parts) {
            if (!part) continue;
            
            // Split CamelCase
            const camelTokens = part
                .replace(/([a-z])([A-Z])/g, '$1\0$2') // lowercase to uppercase boundary
                .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2') // multiple uppercase to uppercase+lowercase
                .split('\0')
                .filter(t => t.length > 0);
            
            tokens.push(...camelTokens);
        }
        
        return tokens;
    }

    /**
     * Extract CamelCase tokens with position information
     */
    static extractCamelCaseTokensWithPositions(
        text: string
    ): Array<{ token: string; position: number }> {
        const results: Array<{ token: string; position: number }> = [];
        let currentPos = 0;
        
        // Handle snake_case and kebab-case by splitting on separators
        const parts = text.split(/([_\-\s]+)/);
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            if (!part || /^[_\-\s]+$/.test(part)) {
                currentPos += part.length;
                continue;
            }
            
            // Split CamelCase
            let tokenStart = currentPos;
            const camelTokens = part
                .replace(/([a-z])([A-Z])/g, '$1\0$2')
                .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
                .split('\0');
            
            for (const token of camelTokens) {
                if (token.length > 0) {
                    results.push({ token, position: tokenStart });
                    tokenStart += token.length;
                }
            }
            
            currentPos += part.length;
        }
        
        return results;
    }

    /**
     * Generate all possible abbreviations for CamelCase matching
     * Example: "getUserName" -> ["gun", "gUN", "gUsN", etc.]
     */
    static generateAbbreviations(text: string): string[] {
        const tokens = this.extractCamelCaseTokens(text);
        if (tokens.length === 0) return [];
        
        const abbreviations = new Set<string>();
        
        // Get first letter of each token
        const firstLetters = tokens.map(t => t[0]);
        
        // Generate combinations
        for (let len = 2; len <= Math.min(tokens.length, 8); len++) {
            const abbr = firstLetters.slice(0, len).join('');
            abbreviations.add(abbr.toLowerCase());
            abbreviations.add(abbr); // Original case
        }
        
        // Also add combinations with more letters from each token
        if (tokens.length >= 2) {
            for (let i = 0; i < tokens.length - 1; i++) {
                for (let j = 1; j <= Math.min(3, tokens[i].length); j++) {
                    const prefix = tokens[i].substring(0, j);
                    const suffix = tokens[i + 1][0];
                    abbreviations.add((prefix + suffix).toLowerCase());
                }
            }
        }
        
        return Array.from(abbreviations);
    }

    /**
     * Check if a query matches an abbreviation pattern
     * Example: "gUN" matches "getUserName"
     */
    static matchesAbbreviation(query: string, text: string): boolean {
        const tokens = this.extractCamelCaseTokens(text);
        if (tokens.length === 0) return false;
        
        const queryLower = query.toLowerCase();
        const tokensLower = tokens.map(t => t.toLowerCase());
        
        // Check if query matches the start of concatenated tokens
        const concatenated = tokensLower.join('').toLowerCase();
        if (concatenated.startsWith(queryLower)) return true;
        
        // Check if query matches first letters of tokens
        const firstLetters = tokensLower.map(t => t[0]).join('');
        if (firstLetters.startsWith(queryLower)) return true;
        
        // Check if query matches with some flexibility (skip tokens)
        let queryIndex = 0;
        let tokenIndex = 0;
        
        while (queryIndex < query.length && tokenIndex < tokens.length) {
            const token = tokensLower[tokenIndex];
            const queryChar = queryLower[queryIndex];
            
            if (token[0] === queryChar) {
                queryIndex++;
                tokenIndex++;
            } else if (token.includes(queryChar)) {
                queryIndex++;
                tokenIndex++;
            } else {
                tokenIndex++;
            }
        }
        
        return queryIndex === query.length;
    }

    /**
     * Calculate fuzzy match score between query and text
     */
    static calculateMatchScore(query: string, text: string, caseSensitive: boolean = false): number {
        const processedQuery = caseSensitive ? query : query.toLowerCase();
        const processedText = caseSensitive ? text : text.toLowerCase();
        
        // Exact match
        if (processedText === processedQuery) return 1000;
        
        // Starts with query
        if (processedText.startsWith(processedQuery)) return 900;
        
        // Contains query
        if (processedText.includes(processedQuery)) return 800;
        
        // CamelCase abbreviation match
        if (this.matchesAbbreviation(query, text)) return 700;
        
        // Fuzzy character match
        let score = 0;
        let queryIdx = 0;
        let lastMatchIdx = -1;
        
        for (let i = 0; i < processedText.length && queryIdx < processedQuery.length; i++) {
            if (processedText[i] === processedQuery[queryIdx]) {
                score += 100;
                
                // Bonus for consecutive matches
                if (lastMatchIdx === i - 1) {
                    score += 50;
                }
                
                // Bonus for matching at word boundaries
                if (i === 0 || /[^a-zA-Z0-9]/.test(processedText[i - 1])) {
                    score += 25;
                }
                
                lastMatchIdx = i;
                queryIdx++;
            }
        }
        
        // All query characters must be matched
        if (queryIdx !== processedQuery.length) return 0;
        
        // Penalize by length difference
        score -= Math.abs(processedText.length - processedQuery.length) * 5;
        
        return Math.max(0, score);
    }

    /**
     * Preprocess text for indexing (remove special characters, normalize)
     */
    static preprocessForIndexing(text: string): string {
        return text
            .replace(/[^\w\s\-_]/g, ' ') // Replace special chars with space
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
}