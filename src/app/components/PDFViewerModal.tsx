'use client';
import { useCallback, useEffect, useState } from 'react';

interface PDFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
  documentId?: string;
  isPDF?: boolean;
}

export default function PDFViewerModal({ 
  isOpen, 
  onClose, 
  fileUrl, 
  fileName, 
  documentId, 
  isPDF = true 
}: PDFViewerModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => (isPDF ? true : false));
  const [activeTab, setActiveTab] = useState<'preview' | 'content'>(
    () => (isPDF ? 'preview' : 'content')
  );
  const [text, setText] = useState<string>('');
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const fetchDocumentText = useCallback(async () => {
    if (!documentId) return;
    setTextLoading(true);
    setTextError(null);
    try {
      const res = await fetch(`/api/documents?id=${documentId}`);
      const data = await res.json();
      if (data.error) {
        setTextError(data.error);
      } else {
        setText(data.fullText || 'No text content available');
      }
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Failed to fetch document text');
    } finally {
      setTextLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen && documentId && activeTab === 'content' && !text && !textLoading && !textError) {
      const timeoutId = setTimeout(() => {
        void fetchDocumentText();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, documentId, activeTab, text, textLoading, textError, fetchDocumentText]);

  useEffect(() => {
    if (isOpen && fileUrl && isPDF) {
      fetch(fileUrl, { method: 'GET', headers: { 'Accept': 'application/json' } })
        .then(async res => {
          if (res.headers.get('content-type')?.includes('application/json')) {
            const data = await res.json();
            throw new Error(data.error || 'File not available');
          }
          if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
          setLoading(false);
        })
        .catch(err => {
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        });
    }
  }, [isOpen, fileUrl, isPDF]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between p-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate flex-1 mr-4">
              {fileName}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {isPDF && (
            <div className="flex border-t border-gray-200 dark:border-gray-800">
              {(['preview', 'content'] as const).map(tab => (
                <button 
                  key={tab} 
                  onClick={() => setActiveTab(tab)} 
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab 
                      ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' 
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {isPDF && activeTab === 'preview' && (
            <div className="h-full overflow-hidden">
              {error ? (
                <div className="flex flex-col items-center justify-center h-full p-8">
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 max-w-md">
                    <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                      PDF File Not Available
                    </h3>
                    <p className="text-yellow-700 dark:text-yellow-300 mb-4">{error}</p>
                    {documentId && (
                      <button 
                        onClick={() => setActiveTab('content')} 
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                      >
                        View Extracted Text Instead
                      </button>
                    )}
                  </div>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 dark:text-gray-400">Loading PDF...</p>
                </div>
              ) : (
                <iframe
                  src={`${fileUrl}${fileUrl.includes('?') ? '&' : '?'}view=true#toolbar=1&navpanes=0&scrollbar=1`}
                  className="w-full h-full border-0"
                  title={fileName}
                  allow="fullscreen"
                  onError={() => setError('Failed to load PDF')}
                />
              )}
            </div>
          )}

          {(!isPDF || activeTab === 'content') && (
            <div className="h-full overflow-auto p-6">
              {textLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 dark:text-gray-400">Loading...</p>
                </div>
              ) : textError ? (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p className="text-red-800 dark:text-red-200">Error: {textError}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Formatting may be inconsistent from source.
                  </p>
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-mono bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    {text || 'No text content available'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}