import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Command, ArrowRight, CornerDownLeft, Sparkles, X } from 'lucide-react';
import { buildCommandCatalog, filterCommands, ACTION_CATEGORIES } from '../command-palette.js';

export function CommandPalette({
  isOpen,
  onClose,
  onExecuteAction,
  tokens = [],
  sessions = [],
  timeMode = 'local',
  layoutMode = 'standard',
  alertCount = 0,
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const catalog = useMemo(() => {
    return buildCommandCatalog({
      tokens,
      sessions,
      timeMode,
      layoutMode,
      alertCount,
    });
  }, [tokens, sessions, timeMode, layoutMode, alertCount]);

  const filtered = useMemo(() => {
    return filterCommands(catalog, query);
  }, [catalog, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) {
        onExecuteAction(item);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop command-palette-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Operator Command Palette"
        className="command-palette-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="command-palette-header">
          <Search size={18} className="command-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command, token symbol, or action… (Esc to close)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Command search"
          />
          <span className="command-esc-badge"><kbd>ESC</kbd></span>
        </div>

        <div className="command-palette-results" role="listbox">
          {filtered.length === 0 ? (
            <div className="command-empty-state">
              <Sparkles size={20} />
              <p>No matching commands or candidates found for "{query}".</p>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`command-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onExecuteAction(item);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="command-item-left">
                    <span className="command-category-pill">{item.category}</span>
                    <span className="command-title">{item.title}</span>
                  </div>
                  <div className="command-item-right">
                    {item.shortcut && <kbd className="command-shortcut">{item.shortcut}</kbd>}
                    {isSelected && <CornerDownLeft size={14} className="command-enter-icon" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>ESC</kbd> Dismiss</span>
          <span className="footer-tip">Tip: Press <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</span>
        </div>
      </section>
    </div>
  );
}
