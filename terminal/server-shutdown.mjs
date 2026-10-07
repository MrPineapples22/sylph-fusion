/**
 * Stop accepting work, allow active requests a bounded drain window, then close
 * request-independent resources. The caller should not force process exit.
 */
export function createGracefulShutdown({
  server,
  stopServices = () => {},
  closeStores = () => {},
  onError = () => {},
  forceAfterMs = 10_000,
}) {
  if (!server || typeof server.close !== 'function' || typeof server.closeAllConnections !== 'function') {
    throw new Error('INVALID_TERMINAL_SHUTDOWN_SERVER');
  }
  if (!Number.isSafeInteger(forceAfterMs) || forceAfterMs < 1 || forceAfterMs > 120_000) {
    throw new Error('INVALID_TERMINAL_SHUTDOWN_TIMEOUT');
  }

  let started = false;
  let resourcesClosed = false;
  return () => {
    if (started) return false;
    started = true;

    try { stopServices(); }
    catch (error) { onError(error, 'stop-services'); }

    const closeResources = () => {
      if (resourcesClosed) return;
      resourcesClosed = true;
      try { closeStores(); }
      catch (error) { onError(error, 'close-stores'); }
    };

    const deadline = setTimeout(() => {
      try { server.closeAllConnections(); }
      catch (error) { onError(error, 'force-close-connections'); }
    }, forceAfterMs);
    deadline.unref?.();

    try {
      server.close(error => {
        clearTimeout(deadline);
        if (error) onError(error, 'close-server');
        closeResources();
      });
      // server.close() stops new connections; this removes idle keep-alives
      // while active requests retain the configured grace period.
      server.closeIdleConnections?.();
    } catch (error) {
      clearTimeout(deadline);
      onError(error, 'close-server');
      closeResources();
    }
    return true;
  };
}
