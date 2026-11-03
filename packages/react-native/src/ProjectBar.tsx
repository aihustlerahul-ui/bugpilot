import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBugPilot } from './BugPilotContext';
import { NO_PROJECTS_TITLE, ProjectList, projectNameOf } from './ProjectList';

/**
 * Top bar in selector mode: current project (tap to change), signed-in email,
 * Sign out. Rendered by SelectorMode, which sits outside the screenshot root.
 */
export function ProjectBar() {
  const {
    projects,
    projectId,
    projectLocked,
    session,
    usingTokenOverride,
    signOut,
  } = useBugPilot();
  // The list also opens on its own when nothing is selected yet (needsPick).
  const [open, setOpen] = useState(false);

  const name = projectNameOf(projects.projects, projectId);
  const ready = projects.status === 'ready';
  const empty = ready && projects.projects.length === 0;
  const needsPick = ready && !empty && !projectId;
  const showList = !projectLocked && (open || needsPick || empty || projects.status === 'error');

  let label: string;
  if (projects.status === 'loading' || projects.status === 'idle') label = 'Loading…';
  else if (empty) label = NO_PROJECTS_TITLE;
  else label = name ?? (projectLocked && projectId ? projectId : 'Choose a project');

  return (
    <View style={styles.wrap} testID="bugpilot-project-bar">
      <View style={styles.bar}>
        <Pressable
          style={styles.projectBtn}
          onPress={() => setOpen((o) => !o)}
          disabled={projectLocked || empty}
          accessibilityRole="button"
          accessibilityLabel={`Project: ${label}. Tap to change`}
          testID="bugpilot-project-current"
        >
          <Text style={styles.barText} numberOfLines={1}>
            Project: <Text style={styles.bold}>{label}</Text>
            {projectLocked || empty ? '' : ' ▾'}
          </Text>
        </Pressable>
        <View style={styles.userBox}>
          <Text style={styles.email} numberOfLines={1}>
            {session?.user.email || (usingTokenOverride ? 'Token override' : '')}
          </Text>
          {session ? (
            <Pressable
              onPress={() => void signOut()}
              accessibilityRole="button"
              accessibilityLabel="Sign out of bugPilot"
              testID="bugpilot-signout"
              hitSlop={8}
            >
              <Text style={styles.signOut}> · Sign out</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {showList ? (
        <View style={styles.dropdown}>
          <ProjectList variant="dark" onPicked={() => setOpen(false)} />
        </View>
      ) : projects.error ? (
        <Text style={styles.error}>{projects.error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  bar: {
    backgroundColor: '#0f1124',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectBtn: {
    flexShrink: 1,
    marginRight: 8,
  },
  barText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  bold: {
    fontWeight: '700',
  },
  userBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  email: {
    color: '#9097b3',
    fontSize: 12,
    flexShrink: 1,
  },
  signOut: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
  },
  dropdown: {
    marginTop: 6,
  },
  error: {
    color: '#FCA5A5',
    backgroundColor: '#0f1124',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    fontSize: 12,
  },
});
