import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.5)';
const DIM    = 'rgba(255,255,255,0.35)';

export default function TermsOfServiceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={MUTED} />
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.updated}>Last updated: 22 April 2026</Text>

        <Section title="1. About POWR">
          POWR ("we", "us", "our") operates the POWR mobile application and website at powr.life.
          By creating an account or using POWR, you agree to these Terms of Service. If you do not agree,
          please do not use our services.
        </Section>

        <Section title="2. Eligibility">
          You must be at least 16 years old to use POWR. By using our services, you confirm that you meet
          this age requirement and that you have the legal capacity to enter into these terms.
        </Section>

        <Section title="3. Your Account">
          • You are responsible for keeping your account credentials secure and for all activity that occurs under your account.{'\n\n'}
          • Please notify us immediately at support@powr.life if you suspect unauthorised access.{'\n\n'}
          • You must provide accurate information when creating your account and keep it up to date.{'\n\n'}
          • You may not create accounts on behalf of others without their consent.
        </Section>

        <Section title="4. POWR Points & Rewards">
          • POWR Points are earned by completing verified physical activities and other qualifying actions within the app.{'\n\n'}
          • Points have no cash value and cannot be sold, transferred, or exchanged for money.{'\n\n'}
          • Rewards are subject to availability and may be withdrawn or changed at any time by us or our partner businesses.{'\n\n'}
          • We reserve the right to adjust or remove points if we reasonably believe they were earned through fraudulent activity or abuse of the system.{'\n\n'}
          • Points may expire if your account is inactive for 12 consecutive months.
        </Section>

        <Section title="5. Health Data">
          POWR integrates with health platforms (such as Apple Health, Google Health Connect, and wearable devices)
          to verify your physical activity. By connecting a health source, you consent to POWR reading relevant
          activity data for the purpose of awarding points. You can revoke this access at any time in your device
          settings. See our Privacy Policy for full details on how we handle health data.
        </Section>

        <Section title="6. Acceptable Use">
          You agree not to:{'\n\n'}
          • Use POWR for any unlawful purpose or in violation of any applicable laws.{'\n\n'}
          • Attempt to manipulate, cheat, or otherwise game the points or rewards system.{'\n\n'}
          • Use automated tools, bots, or scripts to interact with POWR.{'\n\n'}
          • Interfere with or disrupt the integrity or performance of the service.{'\n\n'}
          • Attempt to gain unauthorised access to any part of POWR or its systems.{'\n\n'}
          • Impersonate another person or misrepresent your identity.
        </Section>

        <Section title="7. Partner Businesses">
          Rewards are provided by independent partner businesses. POWR acts as a platform connecting you
          with these partners. We are not responsible for the quality, availability, or fulfilment of
          rewards offered by partners. Any disputes regarding a specific reward should be raised with the
          partner business directly, though we are happy to assist where we can.
        </Section>

        <Section title="8. Intellectual Property">
          All content, branding, and software within the POWR app and website are owned by or licensed to POWR.
          You may not reproduce, distribute, or create derivative works from any POWR content without our
          prior written consent.
        </Section>

        <Section title="9. Disclaimers">
          POWR is provided "as is" without warranties of any kind. We do not guarantee that the service will
          be uninterrupted or error-free, that activity data will always be accurate, or that any specific
          reward will remain available.{'\n\n'}
          POWR is a fitness rewards platform and is not a medical service. Always consult a healthcare
          professional before starting a new exercise programme.
        </Section>

        <Section title="10. Limitation of Liability">
          To the fullest extent permitted by law, POWR shall not be liable for any indirect, incidental,
          or consequential damages arising from your use of the service, including but not limited to loss
          of points, loss of rewards, or data inaccuracies.
        </Section>

        <Section title="11. Termination">
          We reserve the right to suspend or terminate your account at any time if you breach these terms
          or engage in conduct harmful to other users, partner businesses, or POWR.
          You may delete your account at any time from within the app settings.
        </Section>

        <Section title="12. Changes to These Terms">
          We may update these terms from time to time. We will notify you of material changes via the app
          or by email. Continued use of POWR after changes take effect constitutes your acceptance of the
          revised terms.
        </Section>

        <Section title="13. Governing Law">
          These terms are governed by the laws of England and Wales. Any disputes arising from these terms
          shall be subject to the exclusive jurisdiction of the courts of England and Wales.
        </Section>

        <Section title="14. Contact Us">
          If you have any questions about these terms, please contact us at:{'\n\n'}
          <Text style={styles.email}>support@powr.life</Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: 0.2,
  },
  headerSpacer: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  updated: {
    fontSize: 12,
    color: DIM,
    marginBottom: 24,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 22,
  },
  email: {
    color: GOLD,
    fontSize: 14,
  },
});
