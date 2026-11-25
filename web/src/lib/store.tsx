import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ackAlert, fetchAlerts, fetchState, fetchVariables, subscribeEvents, type AlertsData, type HaEntity, type VariablesConfig, type VariablesSchema } from "./api";

type Ctx = {
  entities: Record<string, HaEntity>;
  connected: boolean;
  loading: boolean;
  error: string | null;
  alerts: AlertsData | null;
  variables: VariablesConfig | null;
  schema: VariablesSchema | null;
  refreshAlerts: () => void;
  refreshVariables: () => void;
  ack: (id: string) => Promise<void>;
};

const Store = createContext<Ctx>({
  entities: {},
  connected: false,
  loading: true,
  error: null,
  alerts: null,
  variables: null,
  schema: null,
  refreshAlerts: () => {},
  refreshVariables: () => {},
  ack: async () => {},
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [entities, setEntities] = useState<Record<string, HaEntity>>({});
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertsData | null>(null);
  const [variables, setVariables] = useState<VariablesConfig | null>(null);
  const [schema, setSchema] = useState<VariablesSchema | null>(null);

  const refreshAlerts = useCallback(() => {
    fetchAlerts().then(setAlerts).catch(() => {});
  }, []);

  const refreshVariables = useCallback(() => {
    fetchVariables()
      .then((r) => {
        setVariables(r.variables);
        setSchema(r.schema);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((s) => {
        if (cancelled) return;
        setEntities(s.entities);
        setConnected(s.connected);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    refreshAlerts();
    refreshVariables();
    const poll = setInterval(refreshAlerts, 60000);
    const unsub = subscribeEvents((ev) => {
      if (ev.type === "disconnected") setConnected(false);
      if (ev.type === "connected") setConnected(true);
      if (ev.type === "alerts" && ev.active) {
        setAlerts({ active: ev.active, acked: ev.acked || [], history: ev.history || [], last_run: ev.last_run ?? null, last_error: ev.last_error ?? null });
        return;
      }
      if (ev.type === "variables") {
        if (ev.variables) setVariables(ev.variables);
        else refreshVariables();
        return;
      }
      if (ev.entities) {
        setEntities((prev) => ({ ...prev, ...ev.entities }));
        if (ev.type === "snapshot") {
          setConnected(true);
          setLoading(false);
        }
      }
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
      unsub();
    };
  }, [refreshAlerts, refreshVariables]);

  const ack = useCallback(
    async (id: string) => {
      await ackAlert(id);
      refreshAlerts();
    },
    [refreshAlerts],
  );

  const value = useMemo(
    () => ({ entities, connected, loading, error, alerts, variables, schema, refreshAlerts, refreshVariables, ack }),
    [entities, connected, loading, error, alerts, variables, schema, refreshAlerts, refreshVariables, ack],
  );
  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useHa() {
  return useContext(Store);
}

/** Small polling fetch hook. */
export function usePoll<T>(fn: () => Promise<T>, everyMs = 60000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const run = () =>
      fn()
        .then((d) => {
          if (!live) return;
          setData(d);
          setErr(null);
        })
        .catch((e: Error) => live && setErr(e.message))
        .finally(() => live && setLoading(false));
    run();
    const t = everyMs > 0 ? setInterval(run, everyMs) : null;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, err, loading };
}
