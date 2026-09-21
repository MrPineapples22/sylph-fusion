import { useEffect, useRef, useState } from 'react';
import { createAutomationController } from './automation-controller.js';
export function useAutoSimulateExternal({ state, execution, solPriceUsd }) {
  const controller = useRef(null);
  if (!controller.current) controller.current = createAutomationController();
  const [status, setStatus] = useState('Paused — positions remain open');
  useEffect(() => {
    const next = controller.current.evaluate(state, execution, solPriceUsd);
    if (next) setStatus(next);
  }, [state, execution, solPriceUsd]);
  return status;
}

