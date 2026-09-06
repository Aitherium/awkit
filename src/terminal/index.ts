export {
  createUrlCollector,
  createWrappedLinkProvider,
  findUrls,
  isContinuedRow,
  offsetToPosition,
  readLogicalLine,
  urlsAtRow,
} from './wrapped-links';

export type {
  BufferLineLike,
  LogicalLine,
  ProvidedLink,
  TerminalLike,
  UrlCollector,
  UrlCollectorOptions,
  UrlMatch,
  WrappedLinkProviderOptions,
} from './wrapped-links';
