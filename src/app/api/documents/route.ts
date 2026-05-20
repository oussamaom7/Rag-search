import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
const supabase = createClient(url, anonKey);
const supabaseStorage = createClient(url, serviceKey);

type DocumentMetadata = {
  document_id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  upload_date?: string;
  total_chunks?: number;
  file_url?: string;
  file_path?: string;
  source?: string;
};

type DocumentChunk = {
  content: string;
  metadata?: DocumentMetadata;
};

type DocumentRow = {
  metadata?: DocumentMetadata;
};

type DocumentListItem = DocumentMetadata & {
  id: string;
};

export async function GET(req: Request) {
  try {
    if (!url || !anonKey) {
      console.error('Supabase env missing', {
        hasUrl: Boolean(url),
        hasAnonKey: Boolean(anonKey),
        hasServiceKey: Boolean(serviceKey),
      });
      return NextResponse.json({ error: 'Supabase environment not configured' }, { status: 500 });
    }

    const reqUrl = new URL(req.url);
    const id = reqUrl.searchParams.get('id');
    const file = reqUrl.searchParams.get('file') === 'true';
    const view = reqUrl.searchParams.get('view') === 'true';

    // Handle file download/view
    if (id && file) {
      const { data: documents, error: docError } = await supabase
        .from('documents')
        .select('metadata')
        .eq('metadata->>document_id', id)
        .limit(1);

      if (docError) {
        console.error('Supabase metadata lookup failed', docError);
        return NextResponse.json({ error: docError.message }, { status: 500 });
      }

      if (!documents || documents.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const meta = documents[0].metadata;
      const fileName = meta?.file_name || 'document';
      const fileType = meta?.file_type || 'application/octet-stream';
      const filePath = meta?.file_path || `${id}.${fileName.split('.').pop() || 'pdf'}`;

      const { data: fileData, error: downloadError } = await supabaseStorage.storage
        .from('documents')
        .download(filePath);

      if (downloadError || !fileData) {
        return NextResponse.json({ 
          error: downloadError?.message || 'File not stored' 
        }, { status: 404 });
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (buffer.length === 0) {
        return NextResponse.json({ error: 'File is empty' }, { status: 500 });
      }

      const isPDF = fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': fileType,
          'Content-Disposition': (view && isPDF) 
            ? `inline; filename="${fileName}"` 
            : `attachment; filename="${fileName}"`,
          'Content-Length': buffer.length.toString(),
          ...(view && isPDF ? { 'X-Content-Type-Options': 'nosniff' } : {}),
        },
      });
    }

    // Get single document with text content
    if (id) {
      const { data: chunks, error } = await supabase
        .from('documents')
        .select('content, metadata')
        .eq('metadata->>document_id', id)
        .order('metadata->>chunk_index', { ascending: true });

      if (error) {
        console.error('Supabase chunk lookup failed', error);
      }

      if (error || !chunks || chunks.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const typedChunks = (chunks || []) as DocumentChunk[];
      const m = typedChunks[0]?.metadata || {};
      return NextResponse.json({
        id,
        file_name: m.file_name || 'Unknown',
        file_type: m.file_type || 'unknown',
        file_size: m.file_size || 0,
        upload_date: m.upload_date || new Date().toISOString(),
        total_chunks: typedChunks.length,
        fullText: typedChunks.map((c) => c.content).join('\n\n'),
        file_url: m.file_url,
        file_path: m.file_path
      });
    }

    // List all documents
    const { data: documents, error } = await supabase
      .from('documents')
      .select('metadata');

    if (error) {
      console.error('Supabase document list failed', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Deduplicate documents by document_id
    // Since each document is split into multiple chunks, we need to group them
    const map = new Map<string, DocumentListItem>();
    (documents || []).forEach((doc) => {
      const row = doc as DocumentRow;
      const m = row.metadata;
      if (m?.document_id && !map.has(m.document_id)) {
        map.set(m.document_id, {
          id: m.document_id,
          file_name: m.file_name || 'Unknown',
          file_type: m.file_type || 'unknown',
          file_size: m.file_size || 0,
          upload_date: m.upload_date || new Date().toISOString(),
          total_chunks: m.total_chunks || 0,
          file_url: m.file_url,
          file_path: m.file_path,
        });
      }
    });

    return NextResponse.json({ documents: Array.from(map.values()) });
  } catch (error) {
    console.error('GET /api/documents failed', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
    }

    // Get file path from metadata
    const { data: docs } = await supabase
      .from('documents')
      .select('metadata')
      .eq('metadata->>document_id', id)
      .limit(1);

    const filePath = docs?.[0]?.metadata?.file_path;

    // Delete file from storage
    if (filePath) {
      await supabaseStorage.storage.from('documents').remove([filePath]);
    }

    // Delete all chunks from database
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('metadata->>document_id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, fileDeleted: !!filePath });
  } catch (error) {
    console.error('DELETE /api/documents failed', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}