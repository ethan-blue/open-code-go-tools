import React, { useEffect, useState, useRef } from 'react';
import { useI18n } from '@/i18n';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const navTo = (view: string) => {
    window.dispatchEvent(new CustomEvent('nav-to', { detail: view }));
  };

  const navigateItems = [
    { id: 'dashboard', label: t('cmd_goto_dashboard'), icon: '📊', shortcut: 'Ctrl+1', action: () => navTo('dashboard') },
    { id: 'quickconnect', label: t('cmd_quick_connect'), icon: '🔌', shortcut: 'Ctrl+2', action: () => navTo('terminal') },
    { id: 'traffic', label: t('cmd_goto_traffic'), icon: '📈', shortcut: 'Ctrl+3', action: () => navTo('history') },
    { id: 'sessions', label: t('cmd_goto_sessions'), icon: '💬', shortcut: 'Ctrl+4', action: () => navTo('sessions') },
    { id: 'copilot', label: t('cmd_copilot'), icon: '🤖', shortcut: 'Ctrl+5', action: () => navTo('copilot') },
    { id: 'providers', label: t('cmd_goto_providers'), icon: '🖥', shortcut: 'Ctrl+6', action: () => navTo('providers') },
    { id: 'security', label: t('sett_section_security'), icon: '🛡', action: () => navTo('security') },
    { id: 'hub', label: t('cmd_goto_hub'), icon: '☁', action: () => navTo('hub') },
    { id: 'settings', label: t('cmd_open_settings'), icon: '⚙', shortcut: 'Ctrl+,', action: () => navTo('preferences') },
    { id: 'logs', label: t('sett_log_title'), icon: '📋', action: () => navTo('logs') },
    { id: 'backups', label: t('sett_section_backups'), icon: '💾', action: () => navTo('backups') },
    { id: 'about', label: t('sett_section_about'), icon: 'ℹ', action: () => navTo('about') },
  ];

  const actionItems = [
    { id: 'export', label: t('cmd_export_traffic'), icon: '⬇', shortcut: 'Ctrl+E', action: () => navTo('history') },
    { id: 'theme', label: t('cmd_toggle_theme') || 'Toggle Theme', icon: '🎨', action: () => {
      const current = document.documentElement.getAttribute('data-theme')
      const next = current === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem('theme', next)
    }},
  ];

  const allItems = [...navigateItems, ...actionItems].filter(item =>
    item.label.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % allItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (allItems[selectedIndex]) {
          allItems[selectedIndex].action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, allItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div id="palette" aria-hidden="false" onClick={(e) => {
      if ((e.target as HTMLElement).id === 'palette') onClose();
    }}>
      <div className="cmd" role="dialog" aria-label={t('cmd_palette_aria')} onClick={e => e.stopPropagation()}>
        <div className="input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7"/>
            <path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            ref={inputRef}
            placeholder={t('cmd_placeholder')}
            id="cmdInput"
            autoComplete="off"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <span className="esc" onClick={onClose}>{t('cmd_esc')}</span>
        </div>

        {navigateItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase())).length > 0 && (
          <div className="group">
            <h6>{t('cmd_navigate')}</h6>
            {navigateItems
              .filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
              .map(item => {
                const isSelected = allItems[selectedIndex]?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`item ${isSelected ? 'on' : ''}`}
                    onClick={() => { item.action(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(allItems.findIndex(i => i.id === item.id))}
                  >
                    <span className="ic">{item.icon}</span>
                    {item.label}
                    <span className="spacer"></span>
                    <span className="meta">{item.shortcut}</span>
                  </div>
                );
              })}
          </div>
        )}

        {actionItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase())).length > 0 && (
          <div className="group">
            <h6>{t('cmd_actions')}</h6>
            {actionItems
              .filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
              .map(item => {
                const isSelected = allItems[selectedIndex]?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`item ${isSelected ? 'on' : ''}`}
                    onClick={() => { item.action(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(allItems.findIndex(i => i.id === item.id))}
                  >
                    <span className="ic">{item.icon}</span>
                    {item.label}
                    <span className="spacer"></span>
                    <span className="meta">{item.shortcut}</span>
                  </div>
                );
              })}
          </div>
        )}

        <div className="foot">
          <span>{t('cmd_navigate_keys')}</span>
          <span>{t('cmd_select_key')}</span>
          <span>{t('cmd_close_key')}</span>
          <span style={{ marginLeft: 'auto' }}>{allItems.length} {t('cmd_commands')}</span>
        </div>
      </div>
    </div>
  );
};
