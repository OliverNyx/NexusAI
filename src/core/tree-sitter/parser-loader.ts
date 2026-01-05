import Parser from 'web-tree-sitter';
import { SupportedLanguages } from '../../config/supported-languages';

let parser: Parser | null = null;

// Cache the compiled Language objects to avoid fetching/compiling twice
const languageCache = new Map<string, Parser.Language>();

export const loadParser = async (): Promise<Parser> => {
    if (parser) return parser;

    await Parser.init({
        locateFile: (scriptName: string) => {
            return `/wasm/${scriptName}`;
        }
    })

    parser = new Parser();
    return parser;
}

// Get the appropriate WASM file based on language and file extension
const getWasmPath = (language: SupportedLanguages, filePath?: string): string => {
    // For TypeScript, check if it's a TSX file
    if (language === SupportedLanguages.TypeScript) {
        if (filePath?.endsWith('.tsx')) {
            return '/wasm/typescript/tree-sitter-tsx.wasm';
        }
        return '/wasm/typescript/tree-sitter-typescript.wasm';
    }
    
    const languageFileMap: Record<SupportedLanguages, string> = {
        [SupportedLanguages.JavaScript]: '/wasm/javascript/tree-sitter-javascript.wasm',
        [SupportedLanguages.TypeScript]: '/wasm/typescript/tree-sitter-typescript.wasm',
        [SupportedLanguages.Python]: '/wasm/python/tree-sitter-python.wasm',
    };
    
    return languageFileMap[language];
};

export const loadLanguage = async (language: SupportedLanguages, filePath?: string): Promise<void> => {
    if (!parser) await loadParser();

    const wasmPath = getWasmPath(language, filePath);
    
    // Use wasmPath as cache key to differentiate ts vs tsx
    if (languageCache.has(wasmPath)) {
        parser!.setLanguage(languageCache.get(wasmPath)!);
        return;
    }

    if (!wasmPath) throw new Error(`Unsupported language: ${language}`);
    
    const loadedLanguage = await Parser.Language.load(wasmPath);    
    languageCache.set(wasmPath, loadedLanguage);
    parser!.setLanguage(loadedLanguage);
}
