import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard in dp, or 0 while it's closed.
 *
 * `KeyboardAvoidingView` is unreliable inside a <Modal> on Android: the dialog
 * gets its own window, and under edge-to-edge that window never resizes, so
 * `behavior="height"` measures a frame that never shrinks and the sheet stays
 * sitting under the keyboard. The keyboard events themselves are accurate on
 * both platforms, so sheets pad themselves by this instead.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => { show.remove(); hide.remove(); };
  }, []);

  return height;
}
