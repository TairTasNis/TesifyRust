const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');

// Find the Right Navigation Rail section
const railStart = app.indexOf('{/* Right Navigation Rail for Material 3 */}');
const railEnd = app.indexOf('</div>\n        )}\n      </div>\n\n      {/* Multi-Select Action Bar */}') + 12;

if (railStart === -1 || railEnd === -1) {
    console.log("Could not find bounds");
    process.exit(1);
}

const replacement = `{/* Right Navigation Rail for Material 3 */}
        {layoutTheme === 'material3' && (
          <motion.div 
            drag={md3RailPosition === 'floating'}
            dragMomentum={false}
            className={\`group flex items-center shrink-0 shadow-lg z-50 bg-[var(--md-sys-color-surface-variant)] transition-all duration-300 ease-in-out \${
              md3RailPosition === 'bottom' 
                ? \`flex-row px-4 py-2 gap-4 rounded-t-[32px] md:rounded-[32px] bottom-0 left-1/2 -translate-x-1/2 h-[72px] \${!md3AutoHideRail ? 'mb-4 bottom-24' : 'translate-y-[calc(100%-8px)] hover:translate-y-0 opacity-50 hover:opacity-100 before:absolute before:-top-16 before:inset-x-0 before:h-16 before:bg-transparent'}\`
                : md3RailPosition === 'left'
                ? \`flex-col py-4 px-2 gap-4 rounded-r-[32px] md:rounded-[32px] my-auto h-fit w-[72px] left-0 top-1/2 -translate-y-1/2 \${!md3AutoHideRail ? 'ml-4' : '-translate-x-[calc(100%-8px)] hover:translate-x-0 opacity-50 hover:opacity-100 after:absolute after:-right-16 after:inset-y-0 after:w-16 after:bg-transparent'}\`
                : md3RailPosition === 'floating'
                ? 'flex-col py-4 px-2 gap-4 rounded-[32px] w-[72px] my-auto h-fit cursor-grab active:cursor-grabbing top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
                : \`flex-col py-4 px-2 gap-4 rounded-l-[32px] md:rounded-[32px] my-auto h-fit w-[72px] right-0 top-1/2 -translate-y-1/2 \${!md3AutoHideRail ? 'mr-4' : 'translate-x-[calc(100%-8px)] hover:translate-x-0 opacity-50 hover:opacity-100 before:absolute before:-left-16 before:inset-y-0 before:w-16 before:bg-transparent'}\`
            } \${md3RailPosition !== 'floating' && 'absolute'}\`}
          >
            <button onClick={() => setActiveTab('home')} title="Главная" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12">
              {activeTab === 'home' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
              <Home size={26} className={\`relative z-10 \${activeTab === 'home' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}\`} />
            </button>
            <button onClick={() => setActiveTab('search')} title="Поиск" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12">
              {activeTab === 'search' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
              <Search size={26} className={\`relative z-10 \${activeTab === 'search' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}\`} />
            </button>
            <button onClick={() => setActiveTab('library')} title="Моя медиатека" className="relative group p-3 rounded-full flex items-center justify-center w-12 h-12">
              {activeTab === 'library' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
              <LibraryIcon size={26} className={\`relative z-10 \${activeTab === 'library' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}\`} />
            </button>
            <button onClick={() => { setActiveTab('settings'); setSettingsSection('account'); }} title="Настройки" className={\`relative group p-3 rounded-full flex items-center justify-center w-12 h-12 \${md3RailPosition === 'bottom' ? 'ml-auto' : 'mt-auto'}\`}>
              {activeTab === 'settings' && <motion.div layoutId="md3RightNavTab" className="absolute inset-0 bg-[var(--md-sys-color-secondary-container)] rounded-[20px] z-0" transition={{ type: "spring", stiffness: 300, damping: 30 }} />}
              <SettingsIcon size={26} className={\`relative z-10 \${activeTab === 'settings' ? 'text-[var(--md-sys-color-on-secondary-container)]' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-white'}\`} />
            </button>
          </motion.div>
        )}
      </div>`;

app = app.substring(0, railStart) + replacement + app.substring(railEnd);
fs.writeFileSync('src/App.tsx', app);
console.log('Success');
