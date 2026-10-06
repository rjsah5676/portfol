"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Modal, { type ModalCloseReason } from "./Modal";

interface DialogOptions {
  title?: ReactNode;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
}

interface DialogState extends DialogOptions {
  type: "alert" | "confirm";
  resolve: (ok: boolean) => void;
}

interface ModalApi {
  // window.alert 대체 — 닫히면 resolve
  alert: (options: DialogOptions) => Promise<void>;
  // window.confirm 대체 — 확인 true / 취소·닫기 false
  confirm: (options: DialogOptions) => Promise<boolean>;
}

const ModalContext = createContext<ModalApi | null>(null);

// 모달이 닫히면서 history.back()으로 쌓아둔 히스토리를 소비하는데, 그 전에 호출부가
// router.push 등을 해버리면 back()이 그 이동을 되돌림 -> 소비(popstate)가 끝난 뒤에 resolve
function afterHistoryRestored(fn: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("popstate", finish);
    fn();
  };
  window.addEventListener("popstate", finish);
  setTimeout(finish, 500);
}

const buttonBase = "cursor-pointer rounded-full px-5 py-2 font-mono text-sm transition-colors";

export function ModalProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const open = useCallback(
    (type: DialogState["type"], options: DialogOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...options, type, resolve });
      }),
    []
  );

  const api = useMemo<ModalApi>(
    () => ({
      alert: async (options) => {
        await open("alert", options);
      },
      confirm: (options) => open("confirm", options),
    }),
    [open]
  );

  const close = (ok: boolean, reason?: ModalCloseReason) => {
    if (!dialog) return;
    const { resolve } = dialog;
    setDialog(null);
    if (reason === "popstate") resolve(ok);
    else afterHistoryRestored(() => resolve(ok));
  };

  return (
    <ModalContext.Provider value={api}>
      {children}
      <Modal
        open={dialog !== null}
        onClose={(reason) => close(false, reason)}
        title={dialog?.title}
        initialFocusRef={confirmRef}
        footer={
          <>
            {dialog?.type === "confirm" && (
              <button
                type="button"
                onClick={() => close(false)}
                className={`${buttonBase} border border-white/10 text-white/60 hover:text-white`}
              >
                {dialog.cancelText ?? "취소"}
              </button>
            )}
            <button
              ref={confirmRef}
              type="button"
              onClick={() => close(true)}
              className={`${buttonBase} bg-[#6C63FF] text-white hover:bg-[#5b52f0]`}
            >
              {dialog?.confirmText ?? "확인"}
            </button>
          </>
        }
      >
        {dialog?.message}
      </Modal>
    </ModalContext.Provider>
  );
}

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal은 ModalProvider 안에서만 사용 가능");
  return ctx;
}
