/**
 * Minimal typings for optional peer `react-native-view-shot`.
 * Avoids requiring the package in node_modules for typecheck of this package.
 */
declare module 'react-native-view-shot' {
  import type { RefObject } from 'react';
  import type { ComponentRef } from 'react';
  import type { View } from 'react-native';

  type ViewHandle = ComponentRef<typeof View>;

  export function captureRef(
    ref: RefObject<ViewHandle | null> | ViewHandle,
    options?: {
      format?: 'png' | 'jpg' | 'webm' | 'raw';
      quality?: number;
      result?: 'tmpfile' | 'base64' | 'data-uri';
      width?: number;
      height?: number;
    },
  ): Promise<string>;

  const ViewShot: unknown;
  export default ViewShot;
}
