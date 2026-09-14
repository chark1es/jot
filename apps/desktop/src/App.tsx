import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './App.css';

type Note = {
  readonly id: string;
  readonly createdAt: number;
  title: string;
  body: string;
  updatedAt: number;
  trashed: boolean;
};

type View = 'notes' | 'trash';
type IconName = 'menu' | 'new' | 'notes' | 'search' | 'trash';

const STORAGE_KEY = 'jot.desktop.notes.v1';
const NARROW_QUERY = '(max-width: 720px)';

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number' &&
    typeof record.trashed === 'boolean'
  );
}

function loadNotes(): Note[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isNote) : [];
  } catch {
    return [];
  }
}

function newId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function noteTitle(note: Note): string {
  const title = note.title.trim();
  if (title.length > 0) {
    return title;
  }
  const firstLine = note.body
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim();
  return firstLine?.slice(0, 72) || 'Untitled';
}

function notePreview(note: Note): string {
  const preview = note.body.replace(/\s+/g, ' ').trim();
  return preview.length > 0 ? preview : 'Empty note';
}

function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const onChange = (): void => {
      setNarrow(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);
  return narrow;
}

function shortcutKey(): string {
  return /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}

function Icon({ name }: { readonly name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    new: <path d="M12 5v14M5 12h14" />,
    notes: <path d="M6 4.75h9.5L18 7.5v11.75H6zM9 9.5h6M9 13h6M9 16.5h4" />,
    search: <path d="m19 19-4.1-4.1M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />,
    trash: <path d="M5 7h14M9 7V4.5h6V7m2 0-.75 12h-8.5L7 7m3.5 3.5v5m3-5v5" />,
  };

  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none">
      {paths[name]}
    </svg>
  );
}

export default function App() {
  const initialNotes = useMemo(loadNotes, []);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [activeId, setActiveId] = useState<string | null>(
    initialNotes.find((note) => !note.trashed)?.id ?? null,
  );
  const [view, setView] = useState<View>('notes');
  const [query, setQuery] = useState('');
  const narrow = useNarrowScreen();
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia(NARROW_QUERY).matches);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error'>('saved');
  const searchRef = useRef<HTMLInputElement>(null);

  const activeNote = notes.find((note) => note.id === activeId) ?? null;
  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => note.trashed === (view === 'trash'))
      .filter((note) => {
        if (normalized.length === 0) {
          return true;
        }
        return `${note.title}\n${note.body}`.toLocaleLowerCase().includes(normalized);
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [notes, query, view]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [notes]);

  const createNote = () => {
    const timestamp = Date.now();
    const note: Note = {
      id: newId(),
      title: '',
      body: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      trashed: false,
    };
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setView('notes');
    setQuery('');
    setSidebarOpen(!narrow);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === 'Escape' && window.matchMedia(NARROW_QUERY).matches) {
          setSidebarOpen(false);
        }
        return;
      }
      if (event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault();
        createNote();
      }
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  const updateActive = (changes: Pick<Note, 'body'> | Pick<Note, 'title'>) => {
    const timestamp = Date.now();
    setNotes((current) =>
      current.map((note) =>
        note.id === activeId ? { ...note, ...changes, updatedAt: timestamp } : note,
      ),
    );
  };

  const moveActive = (trashed: boolean) => {
    if (activeNote === null) {
      return;
    }
    const timestamp = Date.now();
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNote.id ? { ...note, trashed, updatedAt: timestamp } : note,
      ),
    );
    const next = notes
      .filter((note) => note.id !== activeNote.id && note.trashed === (view === 'trash'))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    setActiveId(next?.id ?? null);
  };

  const removeActive = () => {
    if (activeNote === null) {
      return;
    }
    setNotes((current) => current.filter((note) => note.id !== activeNote.id));
    setActiveId(visibleNotes.find((note) => note.id !== activeNote.id)?.id ?? null);
  };

  const selectView = (nextView: View) => {
    setView(nextView);
    setQuery('');
    const first = notes
      .filter((note) => note.trashed === (nextView === 'trash'))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    setActiveId(first?.id ?? null);
  };

  const wordCount = activeNote?.body.trim()
    ? activeNote.body.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <a className="skip-link" href="#editor">
        Skip to editor
      </a>

      <div
        className={`sidebar-backdrop ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => {
          setSidebarOpen(false);
        }}
        aria-hidden="true"
      />

      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Notes navigation">
        <div className="sidebar-heading">
          <span className="wordmark">Jot</span>
          <button
            className="icon-button new-note-button"
            type="button"
            onClick={createNote}
            aria-label="New note"
          >
            <Icon name="new" />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Library">
          <button
            className={view === 'notes' ? 'nav-button is-active' : 'nav-button'}
            type="button"
            aria-current={view === 'notes' ? 'page' : undefined}
            onClick={() => {
              selectView('notes');
            }}
          >
            <Icon name="notes" />
            <span>Notes</span>
          </button>
          <button
            className={view === 'trash' ? 'nav-button is-active' : 'nav-button'}
            type="button"
            aria-current={view === 'trash' ? 'page' : undefined}
            onClick={() => {
              selectView('trash');
            }}
          >
            <Icon name="trash" />
            <span>Trash</span>
          </button>
        </nav>

        <label className="search-field">
          <span className="sr-only">Search notes</span>
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search"
          />
          <kbd>{shortcutKey()}</kbd>
        </label>

        <div className="note-list-heading">
          <span>{view === 'notes' ? 'Recent' : 'Deleted'}</span>
          <span>{visibleNotes.length}</span>
        </div>

        <ul className="note-list">
          {visibleNotes.map((note) => (
            <li key={note.id}>
              <button
                className={note.id === activeId ? 'note-row is-active' : 'note-row'}
                type="button"
                aria-current={note.id === activeId ? 'true' : undefined}
                onClick={() => {
                  setActiveId(note.id);
                  if (narrow) {
                    setSidebarOpen(false);
                  }
                }}
              >
                <span className="note-row-topline">
                  <strong>{noteTitle(note)}</strong>
                  <time dateTime={new Date(note.updatedAt).toISOString()}>
                    {formatDate(note.updatedAt)}
                  </time>
                </span>
                <span className="note-preview">{notePreview(note)}</span>
              </button>
            </li>
          ))}
          {visibleNotes.length === 0 && query.trim().length > 0 ? (
            <li className="no-results">No notes match "{query.trim()}".</li>
          ) : null}
        </ul>

        <div className="local-status">
          <span className="status-dot" />
          On this device
        </div>
      </aside>

      <main className="workspace" id="editor">
        <header className="workspace-bar" data-tauri-drag-region>
          <button
            className="icon-button menu-button"
            type="button"
            aria-label={sidebarOpen ? 'Hide notes' : 'Show notes'}
            aria-pressed={sidebarOpen}
            onClick={() => {
              setSidebarOpen((open) => !open);
            }}
          >
            <Icon name="menu" />
          </button>
          <div className="save-status" aria-live="polite">
            {activeNote === null
              ? 'Local notes'
              : saveStatus === 'error'
                ? 'Could not save locally'
                : 'Saved locally'}
          </div>
          {activeNote !== null ? (
            <div className="note-actions">
              {activeNote.trashed ? (
                <>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      moveActive(false);
                    }}
                  >
                    Restore
                  </button>
                  <button className="text-button danger" type="button" onClick={removeActive}>
                    Delete forever
                  </button>
                </>
              ) : (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    moveActive(true);
                  }}
                >
                  Move to trash
                </button>
              )}
            </div>
          ) : null}
        </header>

        {activeNote === null ? (
          <section className="empty-state" aria-labelledby="empty-title">
            <div className="empty-mark" aria-hidden="true">
              <Icon name={view === 'trash' ? 'trash' : 'notes'} />
            </div>
            <h1 id="empty-title">{view === 'trash' ? 'Trash is empty' : 'No notes yet'}</h1>
            <p>
              {view === 'trash'
                ? 'Restore a note or delete it for good.'
                : 'Notes stay on this device and save as you type.'}
            </p>
            {view === 'notes' ? (
              <button className="primary-button" type="button" onClick={createNote}>
                <Icon name="new" />
                New note
              </button>
            ) : null}
          </section>
        ) : (
          <article className="editor">
            <input
              className="title-input"
              aria-label="Note title"
              value={activeNote.title}
              onChange={(event) => {
                updateActive({ title: event.target.value });
              }}
              placeholder="Untitled"
            />
            <textarea
              className="body-input"
              aria-label="Note body"
              value={activeNote.body}
              onChange={(event) => {
                updateActive({ body: event.target.value });
              }}
              placeholder="Start writing…"
              spellCheck="true"
            />
            <footer className="editor-footer">
              <span>{wordCount === 1 ? '1 word' : `${String(wordCount)} words`}</span>
              <span>Edited {formatDate(activeNote.updatedAt)}</span>
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}
