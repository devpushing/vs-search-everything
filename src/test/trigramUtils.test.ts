import * as assert from 'assert';
import { TrigramUtils } from '../utils/trigramUtils';

describe('TrigramUtils', () => {
    
    describe('generateTrigrams', () => {
        it('should generate correct trigrams for simple words', () => {
            const trigrams = TrigramUtils.generateTrigrams('search', false);
            assert.deepStrictEqual(trigrams.sort(), ['arc', 'ear', 'rch', 'sea']);
        });

        it('should handle case sensitivity correctly', () => {
            const caseSensitive = TrigramUtils.generateTrigrams('Search', true);
            const caseInsensitive = TrigramUtils.generateTrigrams('Search', false);
            
            assert.ok(caseSensitive.includes('Sea'));
            assert.ok(!caseInsensitive.includes('Sea'));
            assert.ok(caseInsensitive.includes('sea'));
        });

        it('should return empty array for short strings', () => {
            assert.deepStrictEqual(TrigramUtils.generateTrigrams('ab', false), []);
            assert.deepStrictEqual(TrigramUtils.generateTrigrams('', false), []);
        });

        it('should handle special characters', () => {
            const trigrams = TrigramUtils.generateTrigrams('get_user_name', false);
            assert.ok(trigrams.includes('get'));
            assert.ok(trigrams.includes('use'));
            assert.ok(trigrams.includes('nam'));
        });

        it('should deduplicate trigrams', () => {
            const trigrams = TrigramUtils.generateTrigrams('aaaa', false);
            assert.deepStrictEqual(trigrams, ['aaa']);
        });

        it('should filter out non-alphanumeric trigrams', () => {
            const trigrams = TrigramUtils.generateTrigrams('a---b', false);
            // Should not include '---'
            assert.ok(!trigrams.includes('---'));
        });
    });

    describe('extractCamelCaseTokens', () => {
        it('should extract CamelCase tokens correctly', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('getUserName');
            assert.deepStrictEqual(tokens, ['get', 'User', 'Name']);
        });

        it('should handle consecutive capitals', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('HTTPSConnection');
            assert.deepStrictEqual(tokens, ['HTTPS', 'Connection']);
        });

        it('should handle snake_case', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('snake_case_var');
            assert.deepStrictEqual(tokens, ['snake', 'case', 'var']);
        });

        it('should handle kebab-case', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('kebab-case-var');
            assert.deepStrictEqual(tokens, ['kebab', 'case', 'var']);
        });

        it('should handle mixed formats', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('getUserName_withID');
            assert.deepStrictEqual(tokens, ['get', 'User', 'Name', 'with', 'ID']);
        });

        it('should handle single word', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('config');
            assert.deepStrictEqual(tokens, ['config']);
        });

        it('should handle acronyms at the end', () => {
            const tokens = TrigramUtils.extractCamelCaseTokens('parseJSON');
            assert.deepStrictEqual(tokens, ['parse', 'JSON']);
        });
    });

    describe('matchesAbbreviation', () => {
        it('should match exact first letters', () => {
            assert.ok(TrigramUtils.matchesAbbreviation('gun', 'getUserName'));
            assert.ok(TrigramUtils.matchesAbbreviation('gUN', 'getUserName'));
        });

        it('should match partial tokens', () => {
            assert.ok(TrigramUtils.matchesAbbreviation('getU', 'getUserName'));
            assert.ok(TrigramUtils.matchesAbbreviation('getUserN', 'getUserName'));
        });

        it('should not match incorrect abbreviations', () => {
            assert.ok(!TrigramUtils.matchesAbbreviation('xyz', 'getUserName'));
            assert.ok(!TrigramUtils.matchesAbbreviation('gnu', 'getUserName'));
        });

        it('should handle single token matching', () => {
            assert.ok(TrigramUtils.matchesAbbreviation('conf', 'config'));
            assert.ok(TrigramUtils.matchesAbbreviation('c', 'config'));
        });

        it('should match with flexible token skipping', () => {
            assert.ok(TrigramUtils.matchesAbbreviation('gn', 'getUserName'));
        });

        it('should handle snake_case abbreviations', () => {
            assert.ok(TrigramUtils.matchesAbbreviation('scv', 'snake_case_var'));
            assert.ok(TrigramUtils.matchesAbbreviation('snake', 'snake_case_var'));
        });
    });

    describe('calculateMatchScore', () => {
        it('should give highest score for exact match', () => {
            const score = TrigramUtils.calculateMatchScore('config', 'config', false);
            assert.strictEqual(score, 1000);
        });

        it('should score "starts with" highly', () => {
            const score = TrigramUtils.calculateMatchScore('conf', 'config', false);
            assert.strictEqual(score, 900);
        });

        it('should score "contains" moderately', () => {
            const score = TrigramUtils.calculateMatchScore('fig', 'config', false);
            assert.strictEqual(score, 800);
        });

        it('should score abbreviation matches well', () => {
            const score = TrigramUtils.calculateMatchScore('gun', 'getUserName', false);
            assert.strictEqual(score, 700);
        });

        it('should handle case sensitivity', () => {
            const caseSensitiveScore = TrigramUtils.calculateMatchScore('Config', 'config', true);
            const caseInsensitiveScore = TrigramUtils.calculateMatchScore('Config', 'config', false);
            
            assert.strictEqual(caseSensitiveScore, 0); // No match
            assert.strictEqual(caseInsensitiveScore, 1000); // Exact match
        });

        it('should return 0 for no match', () => {
            const score = TrigramUtils.calculateMatchScore('xyz', 'config', false);
            assert.strictEqual(score, 0);
        });

        it('should handle fuzzy matching', () => {
            const score = TrigramUtils.calculateMatchScore('cnfg', 'config', false);
            assert.ok(score > 0 && score < 700); // Some fuzzy match score
        });

        it('should give bonus for word boundary matches', () => {
            const score1 = TrigramUtils.calculateMatchScore('user', 'getUserName', false);
            const score2 = TrigramUtils.calculateMatchScore('erna', 'getUserName', false);
            assert.ok(score1 > score2); // 'user' at word boundary should score higher
        });
    });

    describe('preprocessForIndexing', () => {
        it('should remove special characters', () => {
            const processed = TrigramUtils.preprocessForIndexing('hello@world#test');
            assert.strictEqual(processed, 'hello world test');
        });

        it('should normalize whitespace', () => {
            const processed = TrigramUtils.preprocessForIndexing('hello   world\t\ntest');
            assert.strictEqual(processed, 'hello world test');
        });

        it('should preserve underscores and hyphens', () => {
            const processed = TrigramUtils.preprocessForIndexing('snake_case-kebab');
            assert.strictEqual(processed, 'snake_case-kebab');
        });

        it('should trim whitespace', () => {
            const processed = TrigramUtils.preprocessForIndexing('  hello world  ');
            assert.strictEqual(processed, 'hello world');
        });

        it('should handle empty strings', () => {
            const processed = TrigramUtils.preprocessForIndexing('');
            assert.strictEqual(processed, '');
        });
    });

    describe('generateTrigramsWithPositions', () => {
        it('should include position information', () => {
            const trigramsWithPos = TrigramUtils.generateTrigramsWithPositions('search', false);
            
            assert.strictEqual(trigramsWithPos.length, 4);
            assert.deepStrictEqual(trigramsWithPos[0], { trigram: 'sea', position: 0 });
            assert.deepStrictEqual(trigramsWithPos[1], { trigram: 'ear', position: 1 });
            assert.deepStrictEqual(trigramsWithPos[2], { trigram: 'arc', position: 2 });
            assert.deepStrictEqual(trigramsWithPos[3], { trigram: 'rch', position: 3 });
        });

        it('should handle special characters with positions', () => {
            const trigramsWithPos = TrigramUtils.generateTrigramsWithPositions('a--bc', false);
            
            // Should skip the '--b' and '-bc' trigrams as they don't contain alphanumeric
            const alphanumericTrigrams = trigramsWithPos.filter(t => /[a-zA-Z0-9]/.test(t.trigram));
            assert.ok(alphanumericTrigrams.length > 0);
        });
    });

    describe('extractCamelCaseTokensWithPositions', () => {
        it('should include position information for tokens', () => {
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions('getUserName');
            
            assert.strictEqual(tokensWithPos.length, 3);
            assert.deepStrictEqual(tokensWithPos[0], { token: 'get', position: 0 });
            assert.deepStrictEqual(tokensWithPos[1], { token: 'User', position: 3 });
            assert.deepStrictEqual(tokensWithPos[2], { token: 'Name', position: 7 });
        });

        it('should handle snake_case with positions', () => {
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions('snake_case_var');
            
            assert.strictEqual(tokensWithPos.length, 3);
            assert.deepStrictEqual(tokensWithPos[0], { token: 'snake', position: 0 });
            assert.deepStrictEqual(tokensWithPos[1], { token: 'case', position: 6 });
            assert.deepStrictEqual(tokensWithPos[2], { token: 'var', position: 11 });
        });

        it('should handle mixed separators', () => {
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions('some-mixed_caseName');
            
            assert.strictEqual(tokensWithPos.length, 4);
            assert.deepStrictEqual(tokensWithPos[0], { token: 'some', position: 0 });
            assert.deepStrictEqual(tokensWithPos[1], { token: 'mixed', position: 5 });
            assert.deepStrictEqual(tokensWithPos[2], { token: 'case', position: 11 });
            assert.deepStrictEqual(tokensWithPos[3], { token: 'Name', position: 15 });
        });
    });
});