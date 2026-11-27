import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { listJournalEntries, searchJournal, type JournalEntry } from '../../src/daily/reflection_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { ActionButton, FormField, PressableCard } from '../../src/ui/controls';
import { formatShortDate } from '../../src/ui/date_format';
import { LightMarkdown } from '../../src/ui/light_markdown';
import { LabelValueRow, ScreenMessage, ScreenScrollView } from '../../src/ui/screen_layout';
import { ui } from '../../src/ui/ui_styles';

/** D3 Journal: today's entry, recent entries, and full-text search across all entries. */
export default function JournalScreen() {
  const { database, daily } = useAppState();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!database) return;
      setEntries(query.trim() === '' ? listJournalEntries(database.executor) : searchJournal(database.executor, query));
    }, [database, query]),
  );

  if (!database || !daily) return <ScreenMessage loading />;
  return (
    <ScreenScrollView testID="screen-journal">
      <ActionButton testID="journal-write-today" label="Write today’s entry" href={`/journal-entry/${daily.today}`} />
      <FormField
        testID="journal-search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search all entries"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      <Text style={ui.muted}>
        {query.trim() === '' ? 'Recent entries' : `${entries.length} match${entries.length === 1 ? '' : 'es'}`}
      </Text>
      {entries.map((entry) => (
        <PressableCard key={entry.id} testID={`journal-entry-${entry.date}`} href={`/journal-entry/${entry.date}`}>
          <LabelValueRow label={formatShortDate(entry.date)} labelStyle="heading" value={entry.mood !== null ? `Mood ${entry.mood}/5` : undefined} />
          <LightMarkdown source={entry.body_md} numberOfLines={3} />
        </PressableCard>
      ))}
    </ScreenScrollView>
  );
}
