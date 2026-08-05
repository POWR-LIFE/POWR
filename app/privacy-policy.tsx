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

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={MUTED} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.updated}>Last updated: 17 April 2026</Text>

        <Section title="1. Who We Are">
          POWR ("we", "us", "our") operates the POWR mobile application and website at powr.life.
          We are committed to protecting your personal data and respecting your privacy.
          This policy explains how we collect, use, and safeguard your information when you use our services.
        </Section>

        <Section title="2. Information We Collect">
          We collect the following categories of information:{'\n\n'}
          • Account information: name, email address, and profile details you provide when you register.{'\n\n'}
          • Health and fitness data: step counts, workout sessions, distance walked or run, and other activity data synced from your device or connected wearables (e.g. Apple Health, Google Health Connect, Fitbit).{'\n\n'}
          • Location data: approximate location used to verify gym visits and show nearby partner rewards. We only access location when you grant permission.{'\n\n'}
          • Usage data: how you interact with the app, features you use, and crash reports to help us improve the service.
        </Section>

        <Section title="3. How We Use Your Information">
          • To provide and operate the POWR rewards platform, including tracking activity and awarding points.{'\n\n'}
          • To verify gym visits and workout sessions for reward eligibility.{'\n\n'}
          • To display relevant partner rewards and offers near your location.{'\n\n'}
          • To communicate with you about your account, rewards, and service updates.{'\n\n'}
          • To improve our services, fix bugs, and develop new features.{'\n\n'}
          • To prevent fraud and ensure the integrity of the rewards system.
        </Section>

        <Section title="4. Legal Basis for Processing">
          We process your personal data on the following legal bases under UK GDPR:{'\n\n'}
          • Contract: processing necessary to provide you with the POWR service you signed up for.{'\n\n'}
          • Consent: for health data and location data, which you explicitly opt in to share.{'\n\n'}
          • Legitimate interest: for analytics, fraud prevention, and service improvement.
        </Section>

        <Section title="5. Data Sharing">
          We do not sell your personal data. We may share data with:{'\n\n'}
          • Partner businesses: only the minimum information needed to fulfil a reward you choose to redeem. We never share your health data with partners.{'\n\n'}
          • Service providers: trusted third parties who help us operate our platform (e.g. hosting, analytics), bound by data processing agreements.{'\n\n'}
          • Legal obligations: where required by law or to protect our rights.
        </Section>

        <Section title="6. Data Retention">
          We retain your personal data for as long as your account is active or as needed to provide you with our services.
          If you delete your account, we will remove your personal data within 30 days, except where we are required to retain it by law.
        </Section>

        <Section title="7. Your Rights">
          Under UK GDPR, you have the right to:{'\n\n'}
          • Access the personal data we hold about you.{'\n\n'}
          • Request correction of inaccurate data.{'\n\n'}
          • Request deletion of your data.{'\n\n'}
          • Withdraw consent at any time (e.g. for health or location data).{'\n\n'}
          • Object to processing based on legitimate interest.{'\n\n'}
          • Request data portability.{'\n\n'}
          To exercise any of these rights, contact us at support@powr.life.
        </Section>

        <Section title="8. Data Security">
          We implement appropriate technical and organisational measures to protect your personal data,
          including encryption in transit and at rest, access controls, and regular security reviews.
        </Section>

        <Section title="9. International Transfers">
          Your data may be processed on servers outside the UK. Where this occurs, we ensure appropriate
          safeguards are in place, such as Standard Contractual Clauses, to protect your data.
        </Section>

        <Section title="10. Children's Privacy">
          POWR is not intended for children under the age of 16. We do not knowingly collect personal
          data from children. If you believe a child has provided us with personal data, please contact
          us and we will delete it.
        </Section>

        <Section title="11. Changes to This Policy">
          We may update this privacy policy from time to time. We will notify you of any material changes
          by posting the updated policy in the app and updating the date above.
        </Section>

        <Section title="12. Contact Us">
          If you have any questions about this privacy policy or our data practices, please contact us at:{'\n\n'}
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
