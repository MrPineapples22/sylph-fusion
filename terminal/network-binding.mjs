import {existsSync} from 'node:fs';

/** Resolve the terminal's network boundary from explicit deployment settings. */
export function resolveTerminalNetworkBinding(env = process.env, {dockerEnvironment = existsSync('/.dockerenv')} = {}) {
  const dockerLoopbackPublished = env.SYLPH_DOCKER_LOOPBACK_PUBLISHED === 'true';
  if (!dockerLoopbackPublished) {
    return Object.freeze({host: '127.0.0.1', allowForwardedPeer: false});
  }

  if (dockerEnvironment !== true) {
    throw new Error('DOCKER_LOOPBACK_PUBLICATION_REQUIRES_DOCKER');
  }

  // Docker must publish this container port on host loopback only. The
  // forwarded connection arrives from Docker's bridge/proxy address, while
  // the terminal still validates the loopback Host/Origin authority below.
  if (env.MODE !== 'paper') {
    throw new Error('DOCKER_LOOPBACK_PUBLICATION_PAPER_ONLY');
  }
  return Object.freeze({host: '0.0.0.0', allowForwardedPeer: true});
}
