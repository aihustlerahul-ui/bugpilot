import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createIssue } from './api/createIssue';
import { useBugPilot } from './BugPilotContext';
import {
  getLastViewShotFailure,
  isViewShotAvailable,
} from './screenshot/ViewShotScreenshotAdapter';
import type { BugSeverity, ReportFormValues } from './types';

const SEVERITIES: BugSeverity[] = ['Low', 'Medium', 'High', 'Critical'];

function elementLabelOf(selected: ReturnType<typeof useBugPilot>['selected']): string {
  if (!selected) return 'No element selected';
  return (
    selected.bugpilotName ||
    selected.testID ||
    selected.accessibilityLabel ||
    selected.text ||
    'Selected region'
  );
}

/**
 * On-device bug form — extension modal parity (Standard Form + Smart input).
 * Opens after selector (#7 Locked). Smart defaults seeded from selection.
 */
export function ReportForm() {
  const { config, selected, pendingScreenshot, closeOverlay } = useBugPilot();
  const elementLabel = useMemo(() => elementLabelOf(selected), [selected]);

  const [smartInput, setSmartInput] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [actualResult, setActualResult] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('Medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Smart defaults from selection (extension-style seed; no AI call).
  useEffect(() => {
    if (defaultsApplied || !selected) return;
    const label = elementLabelOf(selected);
    const route = selected.routeName || config.getRouteName?.() || 'unknown';
    setTitle((prev) => prev || `Issue with ${label}`);
    setExpectedResult(
      (prev) => prev || `Element \`${label}\` functions properly without errors.`,
    );
    setActualResult(
      (prev) =>
        prev ||
        (selected.text
          ? `Observed: ${selected.text}`
          : `Unexpected behavior near ${label} on \`${route}\`.`),
    );
    setDescription(
      (prev) =>
        prev ||
        `### Steps to Reproduce\n1. Navigate to \`${route}\`\n2. Interact with \`${label}\`\n3. Observe the issue`,
    );
    setDefaultsApplied(true);
  }, [selected, config, defaultsApplied]);

  const screenshotStatus = (() => {
    if (pendingScreenshot?.base64) return 'Attached (view-shot)';
    const failure = getLastViewShotFailure();
    if (failure && !failure.available) return failure.message;
    if (isViewShotAvailable()) {
      return 'Capture returned empty — check root ref / permissions';
    }
    return 'No peerDep — install react-native-view-shot + rebuild native app';
  })();

  const onSubmit = async () => {
    setError(null);
    const form: ReportFormValues = {
      title,
      description,
      severity,
      smartInput,
      expectedResult: expectedResult || undefined,
      actualResult: actualResult || undefined,
    };
    if (!form.title.trim() && !form.smartInput?.trim()) {
      setError('Title or smart description is required');
      return;
    }

    setSubmitting(true);
    try {
      const token = await config.getAccessToken();
      const routeName = config.getRouteName?.() || selected?.routeName || undefined;
      const routeParams = config.getRouteParams?.();

      const result = await createIssue({
        apiUrl: config.apiUrl,
        projectId: config.projectId,
        accessToken: token,
        form,
        element: selected,
        routeName,
        environmentInfo: {
          platform: 'react-native',
          os: Platform.OS,
          osVersion: String(Platform.Version),
          ...(routeParams ? { routeParams } : {}),
        },
        screenshot: pendingScreenshot,
      });

      if (!result.ok) {
        setError(result.message || `HTTP ${result.status}`);
        return;
      }
      setSuccess(true);
      setTimeout(() => closeOverlay(), 600);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={closeOverlay}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Report a Bug</Text>
            <Pressable
              onPress={closeOverlay}
              accessibilityRole="button"
              accessibilityLabel="Close bug report"
              testID="bugpilot-form-close"
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.badge}>Target: {elementLabel}</Text>
            {(selected?.routeName || config.getRouteName?.()) ? (
              <Text style={styles.meta}>
                Route: {selected?.routeName || config.getRouteName?.()}
              </Text>
            ) : null}
            {selected?.bounds ? (
              <Text style={styles.meta}>
                Bounds {Math.round(selected.bounds.width)}×{Math.round(selected.bounds.height)} @ (
                {Math.round(selected.bounds.x)}, {Math.round(selected.bounds.y)})
              </Text>
            ) : null}
            {selected?.testID ? (
              <Text style={styles.meta}>testID: {selected.testID}</Text>
            ) : null}
            {selected?.accessibilityLabel ? (
              <Text style={styles.meta}>a11y: {selected.accessibilityLabel}</Text>
            ) : null}
            {selected?.nativeID ? (
              <Text style={styles.meta}>nativeID: {selected.nativeID}</Text>
            ) : null}

            <Text style={styles.label}>What&apos;s wrong? (Smart)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              placeholder="Describe the issue — used if title is empty"
              value={smartInput}
              onChangeText={setSmartInput}
            />

            <Text style={styles.label}>Issue Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="Brief description of the bug"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              placeholder="Steps to reproduce..."
              value={description}
              onChangeText={setDescription}
            />

            <Text style={styles.label}>Expected Result</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              placeholder="What should happen?"
              value={expectedResult}
              onChangeText={setExpectedResult}
            />

            <Text style={styles.label}>Actual Result</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              placeholder="What actually happened?"
              value={actualResult}
              onChangeText={setActualResult}
            />

            <Text style={styles.label}>Severity</Text>
            <View style={styles.sevRow}>
              {SEVERITIES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setSeverity(s)}
                  style={[styles.sevChip, severity === s && styles.sevChipActive]}
                >
                  <Text style={[styles.sevText, severity === s && styles.sevTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.todo}>Screenshot: {screenshotStatus}</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {success ? <Text style={styles.ok}>Submitted</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.secondary}
              onPress={closeOverlay}
              accessibilityRole="button"
              accessibilityLabel="Cancel bug report"
              testID="bugpilot-form-cancel"
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, submitting && styles.disabled]}
              onPress={onSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Save and submit bug report"
              testID="bugpilot-form-submit"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Save & Submit</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  close: {
    fontSize: 18,
    color: '#6B7280',
    padding: 4,
  },
  body: {
    padding: 16,
    paddingBottom: 24,
  },
  badge: {
    backgroundColor: '#F3F4F6',
    color: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
    fontSize: 13,
  },
  meta: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FFF',
  },
  textarea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  sevRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  sevChip: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sevChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  sevText: {
    fontSize: 13,
    color: '#374151',
  },
  sevTextActive: {
    color: '#FFF',
  },
  todo: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 8,
  },
  error: {
    color: '#B91C1C',
    marginTop: 8,
  },
  ok: {
    color: '#047857',
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  secondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  secondaryText: {
    fontWeight: '600',
    color: '#374151',
  },
  primary: {
    flex: 1.2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  primaryText: {
    fontWeight: '700',
    color: '#FFF',
  },
  disabled: {
    opacity: 0.6,
  },
});
