import type { ComponentRef } from 'react';
import type { View } from 'react-native';

/**
 * Instance type behind a `<View ref>`. Portable across RN versions where View
 * is a class (instance = View) and where it is a function component
 * (instance = host element with measureInWindow).
 */
export type NativeViewHandle = ComponentRef<typeof View>;
