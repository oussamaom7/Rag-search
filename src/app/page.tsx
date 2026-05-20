'use client';
import { useState } from 'react';
import Navigation from './components/Navigation';

type Source = {
  content: string;
  metadata?: {
    source?: string;
    file_name?: string;
  };
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); 
    setAnswer(''); 
    setSources([]);
    try {
      const res = await fetch('/api/search', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ query }) 
      });
      const data = await res.json();
      if (data.error) {
        setAnswer(`Error: ${data.error}`);
      } else { 
        setAnswer(data.answer || 'No answer generated'); 
        setSources(data.sources || []); 
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setAnswer(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSearch();
    }
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-6">RAG Search</h1>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm mb-6">
          <textarea 
            className="w-full p-4 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Ask a question about your uploaded documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyPress}
            rows={4}
          />
          <button 
            onClick={handleSearch}
            className="mt-4 bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            disabled={loading || !query.trim()}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Press Cmd/Ctrl + Enter to search
          </p>
        </div>

        {answer && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm mb-6">
            <h2 className="text-xl font-semibold mb-3">Answer:</h2>
            <p className="text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
              {answer}
            </p>
          </div>
        )}

        {sources && sources.length > 0 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-3">Sources ({sources.length}):</h2>
            <div className="space-y-3">
              {sources.map((source, index) => (
                <div
                  key={index}
                  className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    <span className="font-medium">Source:</span>{' '}
                    {source.metadata?.source || source.metadata?.file_name || 'Unknown'}
                  </p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-3">
                    {source.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}