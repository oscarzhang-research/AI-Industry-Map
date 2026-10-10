// Lazy-loaded entry for all editors (keeps the rich-text editor out of the main bundle).
import './editor.css';
import type { EditorRequest } from '../App.tsx';
import ThesisEditor from './ThesisEditor.tsx';
import NoteEditor from './NoteEditor.tsx';
import JournalEditor from './JournalEditor.tsx';
import OutlookEditor from './OutlookEditor.tsx';
import UploadDialog from './UploadDialog.tsx';

export default function EditorHost({ request, onClose }: { request: EditorRequest; onClose: () => void }) {
  // A new key per request so opening another editor starts from a clean form.
  const key = `${request.kind}:${'id' in request ? (request.id ?? 'new') : 'new'}`;
  switch (request.kind) {
    case 'thesis':
      return <ThesisEditor key={key} id={request.id} preset={request.preset} onClose={onClose} />;
    case 'note':
      return <NoteEditor key={key} id={request.id} preset={request.preset} onClose={onClose} />;
    case 'journal':
      return <JournalEditor key={key} id={request.id} onClose={onClose} />;
    case 'outlook':
      return <OutlookEditor key={key} id={request.id} onClose={onClose} />;
    case 'upload':
      return <UploadDialog key={key} onClose={onClose} />;
  }
}
