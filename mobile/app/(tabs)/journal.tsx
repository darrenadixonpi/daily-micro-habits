import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listJournalEntries, searchJournal, type JournalEntry } from '../../src/daily/reflection_repository';
import { useAppState } from '../../src/ui/app_state_context';
import { formatShortDate } from '../../src/ui/date_format';
import { LightMarkdown } from '../../src/ui/light_markdown';
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

  if (!database || !daily) return null;
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <Link href={`/journal-entry/${daily.today}`} asChild>
        <Pressable style={[ui.card, { alignItems: 'center' }]}>
          <Text style={ui.buttonText}>Write today’s entry</Text>
        </Pressable>
      </Link>
      <TextInput
        style={ui.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search all entries"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <Text style={ui.muted}>
        {query.trim() === '' ? 'Recent entries' : `${entries.length} match${entries.length === 1 ? '' : 'es'}`}
      </Text>
      {entries.map((entry) => (
        <Link key={entry.id} href={`/journal-entry/${entry.date}`} asChild>
          <Pressable style={ui.card}>
            <View style={ui.row}>
              <Text style={ui.h2}>{formatShortDate(entry.date)}</Text>
              {entry.mood !== null ? <Text style={ui.muted}>Mood {entry.mood}/5</Text> : null}
            </View>
            <LightMarkdown source={entry.body_md} numberOfLines={3} />
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}
