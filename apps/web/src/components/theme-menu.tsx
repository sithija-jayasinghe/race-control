import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/lib/auth';
import { useTheme, type ThemeChoice } from '@/lib/theme';

const options: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeOptions() {
  const { choice, setChoice } = useTheme();
  return (
    <DropdownMenuRadioGroup value={choice} onValueChange={(value) => setChoice(value as ThemeChoice)}>
      {options.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem key={value} value={value}>
          <Icon aria-hidden="true" />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

const menuClass = 'border-glass-line bg-glass-strong backdrop-blur-xl';

/** Theme choice on its own, for pages without a signed-in user. */
export function ThemeMenu() {
  const { isDark } = useTheme();
  const Current = isDark ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Theme"
        className="glass grid size-[38px] place-items-center rounded-xl text-muted-foreground hover:text-foreground"
      >
        <Current className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menuClass}>
        <ThemeOptions />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in person's menu: who you are, theme, and sign out. */
export function AccountMenu({ email }: { email: string }) {
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="glass grid size-[38px] place-items-center rounded-xl font-display text-sm font-bold uppercase hover:text-foreground"
      >
        {email.charAt(0)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={`${menuClass} min-w-56`}>
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeOptions />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => signOut.mutate(undefined, { onSettled: () => void navigate('/sign-in', { replace: true }) })}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
