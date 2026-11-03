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
import { submitIssue, type CreateIssueResult } from './api/createIssue';
import { useBugPilot } from './BugPilotContext';
import { ProjectList, projectNameOf } from './ProjectList';
import { SignInPanel } from './SignInSheet';
import {
  getLastViewShotFailure,
  isViewShotAvailable,
} from './screenshot/ViewShotScreenshotAdapter';
import type { BugSeverity, ReportFormValues } from './types';

const SEVERITIES: BugSeverity[] = ['Low', 'Medium', 'High', 'Critical'];

/** User-facing submit error; never echoes tokens or raw auth responses. */
function submitErrorMessage(result: Extract<CreateIssueResult, { ok: false }>): string {
  if (result.status === 0) {
    return result.message === 'Choose a project' || result.message.startsWith('Not signed in')
      ? result.message
      : "Couldn't reach bugPilot. Check your connection and retry.";
  }
  if (result.status === 401) return 'Your session expired. Sign in again, then retry.';
  if (result.status === 403 || result.status === 404) {
    return "You don't have access to this project. Pick another project.";
  }
  if (result.status === 400 && result.message) {
    return `Submit rejected: ${result.message.slice(0, 200)}`;
  }
  return `Submit failed (HTTP ${result.status}). Your report is kept — retry.`;
}

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
  const {
    config,
    selected,
    pendingScreenshot,
    closeOverlay,
    projects,
    projectId,
    projectLocked,
    session,
    usingTokenOverride,
    getAccessToken,
    refreshAfter401,
  } = useBugPilot();
  const elementLabel = useMemo(() => elementLabelOf(selected), [selected]);
  const projectName = projectNameOf(projects.projects, projectId);
  // Session lost mid-form (refresh rejected): sign in inline so the draft survives.
  const needsSignIn = !usingTokenOverride && !session;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

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

    if (!projectId) {
      setError('Choose a project');
      setPickerOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const routeName = config.getRouteName?.() || selected?.routeName || undefined;
      const routeParams = config.getRouteParams?.();

      const result = await submitIssue({
        apiUrl: config.apiUrl,
        projectId,
        tokens: { getAccessToken, refreshAfter401 },
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
        // Form state is untouched so the tester can retry.
        setError(submitErrorMessage(result));
        setSubmitFailed(true);
        return;
      }
      setSubmitFailed(false);
      setSuccess(true);
      setTimeout(() => closeOverlay(), 600);
    } catch {
      setError("Couldn't submit. Your report is kept — retry.");
      setSubmitFailed(true);
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

          {needsSignIn ? (
            <SignInPanel />
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Project</Text>
              <Pressable
                style={[styles.input, styles.select]}
                onPress={() => setPickerOpen((o) => !o)}
                disabled={projectLocked}
                accessibilityRole="button"
                accessibilityLabel={`Project: ${projectName ?? 'none selected'}. Tap to change`}
                testID="bugpilot-form-project"
              >
                <Text style={projectName || projectId ? styles.selectText : styles.placeholder}>
                  {projectName ?? projectId ?? 'Choose a project'}
                </Text>
                {projectLocked ? null : <Text style={styles.caret}>{pickerOpen ? '▴' : '▾'}</Text>}
              </Pressable>
              {pickerOpen || (!projectId && !projectLocked) ? (
                <ProjectList onPicked={() => setPickerOpen(false)} />
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

              <View style={styles.summary} testID="bugpilot-form-summary">
                <Text style={styles.summaryTitle}>📎 Auto-attached</Text>
                <Text style={styles.summaryLine}>
                  Screen: {selected?.routeName || config.getRouteName?.() || 'unknown'}
                </Text>
                <Text style={styles.summaryLine}>
                  Element: {elementLabel}
                  {selected?.bounds
                    ? ` · ${Math.round(selected.bounds.width)}×${Math.round(selected.bounds.height)} @ (${Math.round(selected.bounds.x)}, ${Math.round(selected.bounds.y)})`
                    : ''}
                </Text>
                {selected?.testID ? (
                  <Text style={styles.summaryLine}>testID: {selected.testID}</Text>
                ) : null}
                {selected?.accessibilityLabel ? (
                  <Text style={styles.summaryLine}>a11y: {selected.accessibilityLabel}</Text>
                ) : null}
                {selected?.nativeID ? (
                  <Text style={styles.summaryLine}>nativeID: {selected.nativeID}</Text>
                ) : null}
                <Text style={styles.summaryLine}>
                  Device: {Platform.OS} {String(Platform.Version)}
                </Text>
                <Text style={styles.summaryLine}>Screenshot: {screenshotStatus}</Text>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {success ? <Text style={styles.ok}>Submitted</Text> : null}
            </ScrollView>
          )}

          {needsSignIn ? null : (
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
                accessibilityLabel={
                  submitFailed ? 'Retry submitting bug report' : 'Save and submit bug report'
                }
                testID="bugpilot-form-submit"
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>{submitFailed ? 'Retry' : 'Save & Submit'}</Text>
                )}
              </Pressable>
            </View>
          )}
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
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    fontSize: 15,
    color: '#111827',
    flexShrink: 1,
  },
  placeholder: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  caret: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 8,
  },
  summary: {
    backgroundColor: '#f4f5fb',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4b5066',
    marginBottom: 4,
  },
  summaryLine: {
    fontSize: 12,
    color: '#4b5066',
    marginBottom: 2,
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
