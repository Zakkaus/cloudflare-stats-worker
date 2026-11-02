import { useAggregate } from "../hooks";
import { openDrawer } from "../state/store";
import { PanelCard } from "./PanelCard";
import type { Dimension } from "../api/types";

export function Panel({ dimension }: { dimension: Dimension }) {
  const { data, loading, error } = useAggregate(dimension, 8);
  return <PanelCard dimension={dimension} rows={data?.results ?? []} loading={loading} error={error} onDetails={() => openDrawer(dimension)} />;
}
