import { useState, useRef, useEffect, useCallback } from 'react';
import './InfoTooltip.css';

/**
 * InfoTooltip – Reusable info icon with an accessible tooltip.
 *
 * - Desktop: appears on hover and on keyboard focus.
 * - Mobile:  tap toggles; tap outside closes.
 * - Fully accessible: focusable, aria-describedby, Escape to close.
 *
 * @param {{ text: string }} props
 */
export default function InfoTooltip({ text }) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef(null);
  const idRef = useRef(`info-tt-${Math.random().toString(36).slice(2, 8)}`);

  // Close on click outside (mobile)
  const handleClickOutside = useCallback((e) => {
    if (wrapRef.current && !wrapRef.current.contains(e.target)) {
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      document.addEventListener('pointerdown', handleClickOutside, true);
    }
    return () => document.removeEventListener('pointerdown', handleClickOutside, true);
  }, [visible, handleClickOutside]);

  // Toggle on click/tap (mobile-first), also works on desktop
  const handleClick = (e) => {
    e.stopPropagation();
    setVisible((v) => !v);
  };

  // Close on Escape
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setVisible(false);
  };

  return (
    <span
      className="info-tooltip-wrap"
      ref={wrapRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        type="button"
        className="info-tooltip-trigger"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label="Information"
        aria-describedby={visible ? idRef.current : undefined}
      >
        <svg
          className="info-tooltip-icon"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v.5a.75.75 0 001.5 0v-.5zm-1.5 3a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {visible && (
        <span
          className="info-tooltip-bubble"
          id={idRef.current}
          role="tooltip"
        >
          {text}
        </span>
      )}
    </span>
  );
}
