import JSZip from 'jszip';
import { shouldIgnorePath } from '../config/ignore-service';

export interface FileEntry {
    path: string;
    content: string;
}

export const extractZip = async (file: File): Promise<FileEntry[]> => {
    const zip = await JSZip.loadAsync(file);
    const files: FileEntry[] = [];
    const promises: Promise<void>[] = [];

    const processEntry = async (relativePath: string, entry: JSZip.JSZipObject) => {
        if (entry.dir) return;
        if (shouldIgnorePath(relativePath)) return;

        const content = await entry.async('string');
        
        files.push({
            path: relativePath,
            content: content
        });
    };

    zip.forEach((relativePath, entry) => {
        promises.push(processEntry(relativePath, entry));
    });
    
    await Promise.all(promises);
    return files;
};