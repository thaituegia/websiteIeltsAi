import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Health, Profile } from "../shared/types";
import { api } from "./api";

export interface SessionValue {
  user: Profile;
  health: Health | null;
  setUser: (user: Profile | null) => void;
  refresh: () => Promise<void>;
}
export const SessionContext = createContext<SessionValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session provider is missing");
  return value;
}
export function useApi<T>(path: string, timeoutMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<T>(path, { signal: controller.signal, timeoutMs });
      if (id === requestId.current) setData(result);
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : "Không thể kết nối.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path, timeoutMs]);
  useEffect(() => {
    void reload();
    return () => {
      ++requestId.current;
      activeRequest.current?.abort();
    };
  }, [reload]);
  return { data, setData, loading, error, reload };
}
