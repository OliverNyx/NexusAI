import { describe, it, expect } from 'vitest';
import { getLanguageFromFilename } from '../../src/core/ingestion/utils.js';
import { SupportedLanguages } from '../../src/config/supported-languages.js';

describe('getLanguageFromFilename', () => {
  describe('TypeScript', () => {
    it('detects .ts files', () => {
      expect(getLanguageFromFilename('index.ts')).toBe(SupportedLanguages.TypeScript);
    });

    it('detects .tsx files', () => {
      expect(getLanguageFromFilename('Component.tsx')).toBe(SupportedLanguages.TypeScript);
    });

    it('detects .ts files in paths', () => {
      expect(getLanguageFromFilename('src/core/utils.ts')).toBe(SupportedLanguages.TypeScript);
    });
  });

  describe('JavaScript', () => {
    it('detects .js files', () => {
      expect(getLanguageFromFilename('index.js')).toBe(SupportedLanguages.JavaScript);
    });

    it('detects .jsx files', () => {
      expect(getLanguageFromFilename('App.jsx')).toBe(SupportedLanguages.JavaScript);
    });
  });

  describe('Python', () => {
    it('detects .py files', () => {
      expect(getLanguageFromFilename('main.py')).toBe(SupportedLanguages.Python);
    });
  });

  describe('Java', () => {
    it('detects .java files', () => {
      expect(getLanguageFromFilename('Main.java')).toBe(SupportedLanguages.Java);
    });
  });

  describe('C', () => {
    it('detects .c files', () => {
      expect(getLanguageFromFilename('main.c')).toBe(SupportedLanguages.C);
    });

    it('detects .h header files', () => {
      expect(getLanguageFromFilename('header.h')).toBe(SupportedLanguages.C);
    });
  });

  describe('C++', () => {
    it.each(['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh'])(
      'detects %s files',
      (ext) => {
        expect(getLanguageFromFilename(`file${ext}`)).toBe(SupportedLanguages.CPlusPlus);
      }
    );
  });

  describe('C#', () => {
    it('detects .cs files', () => {
      expect(getLanguageFromFilename('Program.cs')).toBe(SupportedLanguages.CSharp);
    });
  });

  describe('Go', () => {
    it('detects .go files', () => {
      expect(getLanguageFromFilename('main.go')).toBe(SupportedLanguages.Go);
    });
  });

  describe('Rust', () => {
    it('detects .rs files', () => {
      expect(getLanguageFromFilename('main.rs')).toBe(SupportedLanguages.Rust);
    });
  });

  describe('PHP', () => {
    it.each(['.php', '.phtml', '.php3', '.php4', '.php5', '.php8'])(
      'detects %s files',
      (ext) => {
        expect(getLanguageFromFilename(`file${ext}`)).toBe(SupportedLanguages.PHP);
      }
    );
  });

  describe('Swift', () => {
    it('detects .swift files', () => {
      expect(getLanguageFromFilename('App.swift')).toBe(SupportedLanguages.Swift);
    });
  });

  describe('unsupported', () => {
    it.each(['.rb', '.kt', '.scala', '.r', '.lua', '.zig', '.txt', '.md', '.json', '.yaml'])(
      'returns null for %s files',
      (ext) => {
        expect(getLanguageFromFilename(`file${ext}`)).toBeNull();
      }
    );

    it('returns null for files without extension', () => {
      expect(getLanguageFromFilename('Makefile')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getLanguageFromFilename('')).toBeNull();
    });
  });
});
