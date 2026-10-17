"use client";

import { useTheme } from "next-themes";
import {
  Check,
  ChevronDown,
  HardDrive,
  Keyboard,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import type { ChatConfig } from "@/lib/chat-schema";

const appearances = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

type WorkspaceSettingsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ChatConfig | null;
};

export function WorkspaceSettings({
  open,
  onOpenChange,
  config,
}: WorkspaceSettingsProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const selectedTheme = theme ?? "system";
  const deviceAppearance = resolvedTheme === "dark" ? "Dark" : "Light";
  const connection = !config
    ? "Checking…"
    : config.demo
      ? "Demo"
      : config.enabled
        ? "Connected"
        : "Unavailable";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-settings" showCloseButton={false}>
        <header className="settings-heading">
          <span className="settings-heading-icon">
            <SlidersHorizontal size={21} strokeWidth={1.6} />
          </span>
          <div>
            <DialogTitle className="settings-title">Settings</DialogTitle>
            <DialogDescription className="settings-description">
              A few preferences to make this space yours.
            </DialogDescription>
          </div>
          <DialogClose className="settings-close" aria-label="Close settings">
            <X size={18} />
          </DialogClose>
        </header>

        <div className="settings-body">
          <fieldset className="appearance-fieldset">
            <legend>Appearance</legend>
            <p className="settings-hint">
              Choose a look, or let Numbase follow your device.
            </p>
            <div className="appearance-options">
              {appearances.map(({ value, label, icon: Icon }) => (
                <label className="appearance-option" key={value}>
                  <input
                    className="appearance-input"
                    type="radio"
                    name="appearance"
                    value={value}
                    checked={selectedTheme === value}
                    onChange={() => setTheme(value)}
                  />
                  <span className="appearance-card">
                    <span
                      className="appearance-preview"
                      data-appearance={value}
                      aria-hidden="true"
                    >
                      <span className="preview-sidebar">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="preview-main">
                        <span className="preview-bubble" />
                        <span className="preview-lines">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="preview-composer" />
                      </span>
                    </span>
                    <span className="appearance-label">
                      <Icon size={16} />
                      <span>{label}</span>
                      <Check className="appearance-check" size={14} />
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="appearance-status" role="status">
              {selectedTheme === "system" ? (
                <Monitor size={14} />
              ) : (
                <Check size={14} />
              )}
              {selectedTheme === "system"
                ? `Following your device · ${deviceAppearance} appearance`
                : `${selectedTheme === "dark" ? "Dark" : "Light"} appearance selected`}
            </p>
          </fieldset>

          <div className="settings-info-grid">
            <section className="settings-info-card">
              <ShieldCheck size={18} strokeWidth={1.6} />
              <div>
                <div className="settings-info-title">
                  <h3>AI connection</h3>
                  <span
                    className={`settings-connection ${config?.demo || config?.enabled === false ? "is-limited" : ""}`}
                  >
                    <i />
                    {connection}
                  </span>
                </div>
                <p>
                  {!config
                    ? "Checking live chat availability."
                    : config.demo
                      ? "You’re viewing sample responses. Live chat hasn’t been enabled yet."
                      : config.enabled
                        ? "Your messages go to the model provider you choose. Your key stays private."
                        : "Live chat is unavailable. Please contact the workspace owner."}
                </p>
              </div>
            </section>
            <section className="settings-info-card">
              <HardDrive size={18} strokeWidth={1.6} />
              <div>
                <h3>Your conversations</h3>
                <p>
                  Saved in this browser, without account sync. Clearing browser
                  data removes them.
                </p>
              </div>
            </section>
          </div>

          <details className="settings-keyboard">
            <summary>
              <Keyboard size={16} />
              <span>Keyboard shortcuts</span>
              <ChevronDown size={14} />
            </summary>
            <div>
              <span>Find a conversation</span>
              <kbd>Ctrl / ⌘ K</kbd>
            </div>
            <div>
              <span>New conversation</span>
              <kbd>Ctrl / ⌘ ⇧ O</kbd>
            </div>
          </details>
        </div>

        <footer className="settings-bottom">
          <span>
            <Check size={13} />
            Preferences save automatically
          </span>
          <DialogClose className="settings-done">Done</DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
