'use client';

import { Upload, File, X, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface Document {
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  createdAt: string;
}

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: documents } = useQuery<Document[]>({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await fetch('/api/documents');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('Upload failed');
      }
      toast.success('File uploaded successfully');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch {
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  }, [queryClient]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">Documents</h3>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-800 hover:border-zinc-700'
        }`}
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 text-blue-500 mx-auto animate-spin" />
        ) : (
          <>
            <Upload className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">
              Drag & drop files or{' '}
              <label className="text-blue-500 cursor-pointer hover:text-blue-400">
                browse
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => handleUpload(e.target.files)}
                />
              </label>
            </p>
          </>
        )}
      </div>

      {documents && documents.length > 0 && (
        <div className="mt-4 space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg">
              <File className="w-4 h-4 text-zinc-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-300 truncate">{doc.name}</p>
                <p className="text-xs text-zinc-600">{formatSize(doc.size)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
