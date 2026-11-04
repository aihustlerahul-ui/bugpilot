import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useBugPilot } from './BugPilotContext';

const GENERIC_ERROR = "Couldn't sign in. Check your connection and try again.";

export type SignInPanelProps = {
  /** Called after a successful sign-in. */
  onSignedIn?: () => void;
  /** Shows a Cancel action when provided. */
  onCancel?: () => void;
};

/**
 * Email + password form for the bugPilot account (same identity as the
 * Chrome extension). Credentials stay in local state and are never logged.
 */
export function SignInPanel({ onSignedIn, onCancel }: SignInPanelProps) {
  const { signIn } = useBugPilot();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      setPassword('');
      onSignedIn?.();
    } catch (e) {
      // Provider already maps errors to user-safe text.
      setError(e instanceof Error && e.message ? e.message : GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View testID="bugpilot-signin">
      <View style={styles.header}>
        <Text style={styles.headerText}>bugPilot · Sign in</Text>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel sign in"
            testID="bugpilot-signin-cancel"
            disabled={loading}
          >
            <Text style={styles.headerClose}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9097b3"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          editable={!loading}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          accessibilityLabel="Email"
          testID="bugpilot-signin-email"
        />
        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9097b3"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          autoComplete="password"
          editable={!loading}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          accessibilityLabel="Password"
          testID="bugpilot-signin-password"
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="bugpilot-signin-error">
            {error}
          </Text>
        ) : null}
        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: !canSubmit, busy: loading }}
          testID="bugpilot-signin-submit"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
        <Text style={styles.note}>Use your bugPilot account. QA builds only.</Text>
      </View>
    </View>
  );
}

/** Bottom sheet shown on the first FAB tap while signed out. */
export function SignInSheet() {
  const { closeOverlay, enterSelector } = useBugPilot();
  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={closeOverlay}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdropTap}
          onPress={closeOverlay}
          accessibilityLabel="Dismiss sign in"
        />
        <View style={styles.sheet}>
          <SignInPanel onSignedIn={enterSelector} onCancel={closeOverlay} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    paddingBottom: 24,
  },
  header: {
    backgroundColor: '#0f1124',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  headerClose: {
    color: '#9097b3',
    fontSize: 16,
    padding: 4,
  },
  body: {
    padding: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e4f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 15,
    color: '#0f1124',
    backgroundColor: '#FFF',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#5b5fc7',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  note: {
    fontSize: 12,
    color: '#9097b3',
    marginTop: 10,
  },
});
