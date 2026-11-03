import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ProjectSummary } from './auth/types';
import { useBugPilot } from './BugPilotContext';

export const NO_PROJECTS_TITLE = 'No projects shared with you yet';
export const NO_PROJECTS_HINT =
  'Ask a workspace admin to add you to a project, or create one on the bugPilot platform.';

export function projectNameOf(projects: ProjectSummary[], id: string | null): string | null {
  if (!id) return null;
  return projects.find((p) => p.id === id)?.name ?? null;
}

export type ProjectListProps = {
  /** Called after a project is picked. */
  onPicked?: () => void;
  /** Dark variant for the selector bar; light for the report form. */
  variant?: 'dark' | 'light';
};

/**
 * Inline project picker (no nested Modal, so it works inside the form sheet).
 * Covers loading, error + Retry, empty and list states.
 */
export function ProjectList({ onPicked, variant = 'light' }: ProjectListProps) {
  const { projects, projectId, setProjectId, reloadProjects } = useBugPilot();
  const dark = variant === 'dark';
  const text = dark ? styles.textDark : styles.textLight;
  const sub = dark ? styles.subDark : styles.subLight;

  if (projects.status === 'loading' || projects.status === 'idle') {
    return (
      <View style={[styles.box, dark ? styles.boxDark : styles.boxLight, styles.row]}>
        <ActivityIndicator color={dark ? '#FFF' : '#5b5fc7'} />
        <Text style={[sub, styles.loadingText]}>Loading projects…</Text>
      </View>
    );
  }

  if (projects.status === 'error') {
    return (
      <View style={[styles.box, dark ? styles.boxDark : styles.boxLight]}>
        <Text style={styles.error}>{projects.error}</Text>
        <Pressable
          onPress={reloadProjects}
          accessibilityRole="button"
          accessibilityLabel="Retry loading projects"
          testID="bugpilot-projects-retry"
        >
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (projects.projects.length === 0) {
    return (
      <View
        style={[styles.box, dark ? styles.boxDark : styles.boxLight]}
        testID="bugpilot-projects-empty"
      >
        <Text style={[text, styles.emptyTitle]}>{NO_PROJECTS_TITLE}</Text>
        <Text style={sub}>{NO_PROJECTS_HINT}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, dark ? styles.boxDark : styles.boxLight]}>
      {projects.error ? <Text style={styles.error}>{projects.error}</Text> : null}
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {projects.projects.map((p) => {
          const active = p.id === projectId;
          return (
            <Pressable
              key={p.id}
              onPress={() => {
                setProjectId(p.id);
                onPicked?.();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Project ${p.name}`}
              accessibilityState={{ selected: active }}
              style={[styles.item, active && (dark ? styles.itemActiveDark : styles.itemActiveLight)]}
              testID={`bugpilot-project-${p.id}`}
            >
              <Text style={[text, active && styles.itemActiveText]} numberOfLines={1}>
                {active ? '✓ ' : ''}
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 10,
    padding: 10,
  },
  boxDark: {
    backgroundColor: '#1b1e36',
  },
  boxLight: {
    backgroundColor: '#f4f5fb',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 8,
  },
  scroll: {
    maxHeight: 220,
  },
  item: {
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  itemActiveDark: {
    backgroundColor: '#5b5fc7',
  },
  itemActiveLight: {
    backgroundColor: '#e2e4f0',
  },
  itemActiveText: {
    fontWeight: '700',
  },
  textDark: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  textLight: {
    color: '#0f1124',
    fontSize: 14,
  },
  subDark: {
    color: '#9097b3',
    fontSize: 12,
  },
  subLight: {
    color: '#4b5066',
    fontSize: 12,
  },
  emptyTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 6,
  },
  link: {
    color: '#5b5fc7',
    fontWeight: '700',
    fontSize: 13,
  },
});
