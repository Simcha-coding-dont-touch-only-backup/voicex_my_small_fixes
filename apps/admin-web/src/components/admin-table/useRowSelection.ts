import { useCallback, useMemo, useState } from 'react';

export function useRowSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((currentIds: string[]) => {
    setSelected((prev) => {
      const selectedOnPage = currentIds.filter((id) => prev.has(id)).length;
      if (selectedOnPage > 0) {
        const next = new Set(prev);
        for (const id of currentIds) next.delete(id);
        return next;
      }
      return new Set(currentIds);
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const getSelectionState = useCallback(
    (currentIds: string[]) => {
      const selectedOnPage = currentIds.filter((id) => selected.has(id)).length;
      const allSelected = currentIds.length > 0 && selectedOnPage === currentIds.length;
      const someSelected = selectedOnPage > 0 && !allSelected;
      return { allSelected, someSelected, selectedOnPage };
    },
    [selected],
  );

  const selectedList = useCallback(
    <T extends { id: string }>(rows: T[]) => rows.filter((row) => selected.has(row.id)),
    [selected],
  );

  return useMemo(
    () => ({
      selected,
      selectedCount,
      toggleOne,
      toggleAll,
      clear,
      isSelected,
      getSelectionState,
      selectedList,
    }),
    [selected, selectedCount, toggleOne, toggleAll, clear, isSelected, getSelectionState, selectedList],
  );
}

export type UseRowSelectionResult = ReturnType<typeof useRowSelection>;
