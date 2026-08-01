"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/shared/utils/cn";

export default function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = "Select options",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (optionValue) => {
    if (disabled) return;
    const isSelected = value.includes(optionValue);
    const newValue = isSelected
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const clearAll = (e) => {
    e.stopPropagation();
    onChange([]);
  };

  const selectedCount = value.length;
  const displayText =
    selectedCount === 0
      ? placeholder
      : selectedCount === 1
        ? options.find((o) => o.value === value[0])?.label || value[0]
        : `${selectedCount} selected`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} ref={containerRef}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div
        className="relative"
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <div
          className={cn(
            "w-full py-2.5 px-3 pr-10 text-sm text-text-main min-h-[42px]",
            "bg-surface-2 border border-transparent rounded-[10px]",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
            "text-[16px] sm:text-sm flex flex-wrap items-center gap-1",
            error &&
              "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40",
            selectClassName
          )}
        >
          {value.length > 0 ? (
            value.map((val) => {
              const option = options.find((o) => o.value === val);
              return option ? (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 bg-brand-500/10 text-brand-600 dark:text-brand-400 px-2 py-0.5 rounded text-xs"
                >
                  {option.label}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(val);
                    }}
                    className="hover:bg-brand-500/20 rounded-full px-0.5"
                  >
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </span>
              ) : null;
            })
          ) : (
            <span className="text-text-muted">{displayText}</span>
          )}

          {value.length > 0 && !disabled && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-text-muted hover:text-text-main ml-1"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}

          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted ml-auto">
            <span className="material-symbols-outlined text-[20px]">
              {isOpen ? "expand_less" : "expand_more"}
            </span>
          </div>
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 max-h-[280px] overflow-y-auto z-50 rounded-[10px] border border-border bg-surface-2 shadow-xl">
            <div className="p-1">
              {options.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted text-center">
                  No options available
                </div>
              ) : (
                options.map((option) => {
                  const isSelected = value.includes(option.value);
                  return (
                    <div
                      key={option.value}
                      onClick={() => toggleOption(option.value)}
                      className={cn(
                        "px-3 py-2 rounded text-sm cursor-pointer transition-colors",
                        isSelected
                          ? "bg-brand-500/10 text-brand-600 dark:text-brand-400"
                          : "hover:bg-black/5 dark:hover:bg-white/5 text-text-main"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "material-symbols-outlined text-[18px]",
                            isSelected ? "text-brand-600 dark:text-brand-400" : "text-text-muted"
                          )}
                        >
                          {isSelected ? "check_box" : "check_box_outline_blank"}
                        </span>
                        <span>{option.label}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}