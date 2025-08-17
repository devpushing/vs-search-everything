#!/usr/bin/env node

// Standalone test that can run without VS Code dependencies
import * as assert from 'assert';
import { TrigramUtils } from '../utils/trigramUtils';

let testCount = 0;
let passedCount = 0;
let failedCount = 0;

function test(name: string, fn: () => void) {
    testCount++;
    try {
        fn();
        passedCount++;
        console.log(`✅ ${name}`);
    } catch (error) {
        failedCount++;
        console.log(`❌ ${name}`);
        console.error(`   ${error}`);
    }
}

console.log('🧪 Running TrigramUtils Tests\n');

// Test generateTrigrams
test('generateTrigrams: should generate correct trigrams', () => {
    const trigrams = TrigramUtils.generateTrigrams('search', false);
    assert.deepStrictEqual(trigrams.sort(), ['arc', 'ear', 'rch', 'sea']);
});

test('generateTrigrams: should handle case sensitivity', () => {
    const caseSensitive = TrigramUtils.generateTrigrams('Search', true);
    const caseInsensitive = TrigramUtils.generateTrigrams('Search', false);
    
    assert.ok(caseSensitive.includes('Sea'));
    assert.ok(!caseInsensitive.includes('Sea'));
    assert.ok(caseInsensitive.includes('sea'));
});

test('generateTrigrams: should return empty for short strings', () => {
    assert.deepStrictEqual(TrigramUtils.generateTrigrams('ab', false), []);
    assert.deepStrictEqual(TrigramUtils.generateTrigrams('', false), []);
});

test('generateTrigrams: should handle special characters', () => {
    const trigrams = TrigramUtils.generateTrigrams('get_user_name', false);
    assert.ok(trigrams.includes('get'));
    assert.ok(trigrams.includes('use'));
    assert.ok(trigrams.includes('nam'));
});

test('generateTrigrams: should deduplicate', () => {
    const trigrams = TrigramUtils.generateTrigrams('aaaa', false);
    assert.deepStrictEqual(trigrams, ['aaa']);
});

// Test extractCamelCaseTokens
test('extractCamelCaseTokens: should extract CamelCase correctly', () => {
    const tokens = TrigramUtils.extractCamelCaseTokens('getUserName');
    assert.deepStrictEqual(tokens, ['get', 'User', 'Name']);
});

test('extractCamelCaseTokens: should handle consecutive capitals', () => {
    const tokens = TrigramUtils.extractCamelCaseTokens('HTTPSConnection');
    assert.deepStrictEqual(tokens, ['HTTPS', 'Connection']);
});

test('extractCamelCaseTokens: should handle snake_case', () => {
    const tokens = TrigramUtils.extractCamelCaseTokens('snake_case_var');
    assert.deepStrictEqual(tokens, ['snake', 'case', 'var']);
});

test('extractCamelCaseTokens: should handle kebab-case', () => {
    const tokens = TrigramUtils.extractCamelCaseTokens('kebab-case-var');
    assert.deepStrictEqual(tokens, ['kebab', 'case', 'var']);
});

test('extractCamelCaseTokens: should handle mixed formats', () => {
    const tokens = TrigramUtils.extractCamelCaseTokens('getUserName_withID');
    assert.deepStrictEqual(tokens, ['get', 'User', 'Name', 'with', 'ID']);
});

// Test matchesAbbreviation
test('matchesAbbreviation: should match first letters', () => {
    assert.ok(TrigramUtils.matchesAbbreviation('gun', 'getUserName'));
    assert.ok(TrigramUtils.matchesAbbreviation('gUN', 'getUserName'));
});

test('matchesAbbreviation: should match partial tokens', () => {
    assert.ok(TrigramUtils.matchesAbbreviation('getU', 'getUserName'));
    assert.ok(TrigramUtils.matchesAbbreviation('getUserN', 'getUserName'));
});

test('matchesAbbreviation: should not match incorrect', () => {
    assert.ok(!TrigramUtils.matchesAbbreviation('xyz', 'getUserName'));
    assert.ok(!TrigramUtils.matchesAbbreviation('gnu', 'getUserName'));
});

// Test calculateMatchScore
test('calculateMatchScore: exact match scores 1000', () => {
    const score = TrigramUtils.calculateMatchScore('config', 'config', false);
    assert.strictEqual(score, 1000);
});

test('calculateMatchScore: starts with scores 900', () => {
    const score = TrigramUtils.calculateMatchScore('conf', 'config', false);
    assert.strictEqual(score, 900);
});

test('calculateMatchScore: contains scores 800', () => {
    const score = TrigramUtils.calculateMatchScore('fig', 'config', false);
    assert.strictEqual(score, 800);
});

test('calculateMatchScore: abbreviation scores 700', () => {
    const score = TrigramUtils.calculateMatchScore('gun', 'getUserName', false);
    assert.strictEqual(score, 700);
});

test('calculateMatchScore: no match scores 0', () => {
    const score = TrigramUtils.calculateMatchScore('xyz', 'config', false);
    assert.strictEqual(score, 0);
});

test('calculateMatchScore: handles case sensitivity', () => {
    const caseSensitive = TrigramUtils.calculateMatchScore('Config', 'config', true);
    const caseInsensitive = TrigramUtils.calculateMatchScore('Config', 'config', false);
    
    // When case sensitive, 'Config' !== 'config', but can still fuzzy match
    assert.ok(caseSensitive < 1000, 'Case sensitive should not exact match');
    assert.strictEqual(caseInsensitive, 1000);
});

// Test preprocessForIndexing
test('preprocessForIndexing: removes special chars', () => {
    const processed = TrigramUtils.preprocessForIndexing('hello@world#test');
    assert.strictEqual(processed, 'hello world test');
});

test('preprocessForIndexing: normalizes whitespace', () => {
    const processed = TrigramUtils.preprocessForIndexing('hello   world\t\ntest');
    assert.strictEqual(processed, 'hello world test');
});

test('preprocessForIndexing: preserves underscores/hyphens', () => {
    const processed = TrigramUtils.preprocessForIndexing('snake_case-kebab');
    assert.strictEqual(processed, 'snake_case-kebab');
});

test('preprocessForIndexing: trims whitespace', () => {
    const processed = TrigramUtils.preprocessForIndexing('  hello world  ');
    assert.strictEqual(processed, 'hello world');
});

// Test generateTrigramsWithPositions
test('generateTrigramsWithPositions: includes positions', () => {
    const trigramsWithPos = TrigramUtils.generateTrigramsWithPositions('search', false);
    
    assert.strictEqual(trigramsWithPos.length, 4);
    assert.deepStrictEqual(trigramsWithPos[0], { trigram: 'sea', position: 0 });
    assert.deepStrictEqual(trigramsWithPos[1], { trigram: 'ear', position: 1 });
    assert.deepStrictEqual(trigramsWithPos[2], { trigram: 'arc', position: 2 });
    assert.deepStrictEqual(trigramsWithPos[3], { trigram: 'rch', position: 3 });
});

// Test extractCamelCaseTokensWithPositions
test('extractCamelCaseTokensWithPositions: includes positions', () => {
    const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions('getUserName');
    
    assert.strictEqual(tokensWithPos.length, 3);
    assert.deepStrictEqual(tokensWithPos[0], { token: 'get', position: 0 });
    assert.deepStrictEqual(tokensWithPos[1], { token: 'User', position: 3 });
    assert.deepStrictEqual(tokensWithPos[2], { token: 'Name', position: 7 });
});

test('extractCamelCaseTokensWithPositions: handles snake_case', () => {
    const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions('snake_case_var');
    
    assert.strictEqual(tokensWithPos.length, 3);
    assert.deepStrictEqual(tokensWithPos[0], { token: 'snake', position: 0 });
    assert.deepStrictEqual(tokensWithPos[1], { token: 'case', position: 6 });
    assert.deepStrictEqual(tokensWithPos[2], { token: 'var', position: 11 });
});

// Print results
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passedCount}/${testCount} passed`);
if (failedCount > 0) {
    console.log(`❌ ${failedCount} tests failed`);
    process.exit(1);
} else {
    console.log('✅ All tests passed!');
    process.exit(0);
}