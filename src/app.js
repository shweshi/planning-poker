(async () => {
  const OPEN_DELAY = 3;
  const MODERATOR_COLOR_PRIMARY = "#4DD163";
  const PARTICIPANT_COLOR_PRIMARY = "#dc851c";

  // If URL doesn't contain a session id - generate a new one then redirect.
  const sessionId = window.location.pathname;
  if (sessionId === "/" || sessionId === "") {
    let sessionId = uuidv4();
    window.location.href = `${window.location.origin}/${sessionId}`;
  }

  MESSAGE_TYPE = {
    STATE_REQUEST: "state_request",
    STATE: "state",
    REVEAL_CARDS: "reveal_cards",
    RENEW_GAME: "renew_game",
    DISCONNECT: "disconnect",
    PING: "ping",
  };

  const App = {
    data() {
      return {
        cards: [],
        counter: 0,
        isCardsOpen: false,
        openDelayCounter: 0,
        playerId: "",
        playerName: "",
        playerRole: "",
        variants: [...randomVariants(), "?"],
        vote: null,
        votingData: {
          averageVote: 0,
          highestVote: 0,
          lowestVote: 0,
          totalVotes: 0,
          consensus: 0
        },
      };
    },

    mounted() {
      let playerName = localStorage.getItem("playerName");
      let playerId = localStorage.getItem("playerId");
      let playerRole = localStorage.getItem("playerRole");

      // Generating a new unique `playerId` if not defined.
      if (!playerId) {
        playerId = uuidv4();
        localStorage.setItem("playerId", playerId);
      }
      this.playerId = playerId;
      this.playerRole = playerRole;

      // Asking the user to enter the player's name if it is not defined.
      if (!playerName || !playerRole) {
        playerName = "User";
        playerRole = "Participant";
        let newName = prompt("Enter your name", playerName);

        if (newName) {
          playerName = newName;
        }

        localStorage.setItem("playerName", playerName);
        localStorage.setItem("playerRole", playerRole);
      }
      this.playerName = playerName;
      this.playerRole = playerRole;

      let vote = localStorage.getItem("vote");
      this.vote = (vote && vote.length) ? Number(vote) : null;

      // Setting the default card value with no vote.
      if (this.playerRole === 'Participant') {
        this.cards = [
          {
            playerName: this.playerName,
            playerId: this.playerId,
            vote: this.vote,
          },
        ];

        generateAvatar(PARTICIPANT_COLOR_PRIMARY);
        showNotification("You have joined as a participant.");
      } else {
        setModeratorColor();
      }

      let connect = () => {
        let schema = window.location.protocol === "https:" ? "wss" : "ws";
        this.socket = new WebSocket(
          `${schema}://${window.location.hostname}:${window.location.port}${window.location.pathname}`
        );

        this.socket.addEventListener("error", (event) => {
          console.error("WebSocket error", event);
        });

        // Trying to re-reconnect each time on disconnect.
        this.socket.addEventListener("close", (event) => {
          if (this.keepAliveEmitter) {
            clearInterval(this.keepAliveEmitter);

            // Trying to reconnect.
            setTimeout(() => {
              connect();
            }, 1000);
          }

          console.error("WebSocket connection is closed.", event);
        });

        this.socket.addEventListener("open", (event) => {
          // Init backend auto-ping, to keep connectoion alive.
          this.keepAliveEmitter = setInterval(() => {
            let msg = JSON.stringify({
              type: MESSAGE_TYPE.PING,
              playerId: this.playerId,
            });
            this.socket.send(msg);
          }, 5000);

          msg = JSON.stringify({
            playerId: this.playerId,
            type: MESSAGE_TYPE.STATE_REQUEST,
          });
          this.socket.send(msg);
        });

        this.socket.addEventListener("message", (messageEvent) => {
          let message = JSON.parse(messageEvent.data);

          // If another player requested our STATE - send it.
          if (message.type === MESSAGE_TYPE.STATE_REQUEST) {
            this.socket.send(
              JSON.stringify({
                type: MESSAGE_TYPE.STATE,
                playerId: this.playerId,
                playerName: this.playerName,
                playerRole: this.playerRole,
                vote: this.vote,
                counter: this.counter,
                isCardsOpen: this.isCardsOpen,
                openDelayCounter: this.openDelayCounter,
                votingData: this.votingData
              })
            );
          }

          // If the player is disconnected - remove his cart from the table.
          if (message.type === MESSAGE_TYPE.DISCONNECT) {
            for (let cardIdx in this.cards) {
              if (this.cards[cardIdx].playerId == message.playerId) {
                this.cards.splice(cardIdx, 1);
              }
            }
          }

          // If a new STATE of any player is received, simply update the cards
          // on the table.
          if (message.type === MESSAGE_TYPE.STATE) {
            let found = false;
            this.cards.forEach((card) => {
              if (card.playerId === message.playerId) {
                card.playerName = message.playerName;
                card.vote = message.vote;
                found = true;
              }
            });
            if (!found) {
              this.cards.push({
                playerName: message.playerName,
                playerId: message.playerId,
                vote: message.vote,
              });
            }

            if (message.playerRole === 'Moderator') {
              this.isCardsOpen = message.isCardsOpen;
              this.openDelayCounter = message.openDelayCounter;
              this.votingData = message.votingData;
            }
          }

          // If a REVEAL message is received, open cards after the OPEN_DELAY
          // interval.
          if (message.type === MESSAGE_TYPE.REVEAL_CARDS) {
            // If we get REVEAL_CARDS, start the open interval from start.
            if (this.openDelayInterval) {
              clearInterval(this.openDelayInterval);
            }

            this.openDelayCounter = OPEN_DELAY;
            this.openDelayInterval = setInterval(() => {
              this.openDelayCounter--;

              if (this.openDelayCounter <= 0) {
                this.isCardsOpen = true;
                const { averageVote, highestVote, lowestVote, totalVotes, consensus } = this.calculateVotingData();

                this.votingData = {
                  averageVote,
                  highestVote,
                  lowestVote,
                  totalVotes,
                  consensus
                }

                if (consensus) {
                  fireConfetti();
                }
                // Update the voting results and calculate average.
                // `setTimeout` is required to wait for `v-if` is ready.
                setTimeout(() => {
                  votemap = this.cards.reduce(function (r, a) {
                    if (a.vote) {
                      r[a.vote] = (r[a.vote] || 0) + 1;
                    }
                    return r;
                  }, {});
                  showVoteCloud(this.cards, this.votingData.highestVote)
                }, 0);

                clearInterval(this.openDelayInterval);
              }
            }, 1000);
          }

          // If a RENEW_GAME message is received, close all cards, reset our
          // vote, re-new card variants and send our new STATE to the other
          // players.
          if (message.type === MESSAGE_TYPE.RENEW_GAME) {
            this.isCardsOpen = false;
            this.vote = null;
            localStorage.removeItem('vote');
            this.cards.splice(1, this.cards.length);
            this.cards[0].vote = null;
            this.variants = [...randomVariants(), "?"];

            this.socket.send(
              JSON.stringify({
                type: MESSAGE_TYPE.STATE,
                playerName: this.playerName,
                playerId: this.playerId,
                vote: this.vote,
              })
            );
          }
        }
        );
      };

      connect();
    },

    methods: {
      onVote(vote) {
        this.vote = vote;
        localStorage.setItem("vote", this.vote);
        this.socket.send(
          JSON.stringify({
            type: MESSAGE_TYPE.STATE,
            playerName: this.playerName,
            playerId: this.playerId,
            vote: this.vote,
          })
        );
      },

      onClearVote() {
        this.vote = null;
        localStorage.setItem("vote", this.vote);
        this.socket.send(
          JSON.stringify({
            type: MESSAGE_TYPE.STATE,
            playerName: this.playerName,
            playerId: this.playerId,
            vote: this.vote,
          })
        );
      },

      onRename() {
        let newName = prompt("Enter your name", this.playerName);
        if (newName) {
          this.playerName = newName;
        }

        localStorage.setItem("playerName", this.playerName);

        this.socket.send(
          JSON.stringify({
            type: MESSAGE_TYPE.STATE,
            playerName: this.playerName,
            playerId: this.playerId,
            vote: this.vote,
          })
        );

        this.playerRole === "Moderator" ? generateAvatar(MODERATOR_COLOR_PRIMARY) : generateAvatar(PARTICIPANT_COLOR_PRIMARY);
      },

      onRoleChange(event) {
        if (event.target.checked) {
          this.playerRole = "Moderator";
          localStorage.setItem("playerRole", this.playerRole);
          setModeratorColor();
        } else {
          this.playerRole = "Participant";
          localStorage.setItem("playerRole", this.playerRole);
          setParticipantColor();
        }
      },

      onRevealCards() {
        this.socket.send(
          JSON.stringify({
            playerId: this.playerId,
            type: MESSAGE_TYPE.REVEAL_CARDS,
          })
        );
      },

      onStartNewVoting() {
        this.socket.send(
          JSON.stringify({
            playerId: this.playerId,
            type: MESSAGE_TYPE.RENEW_GAME,
          })
        );
      },

      calculateVotingData() {
        let score = 0;
        let count = 0;
        let consensus = this.cards.filter(val => val.vote).every((val, i, arr) => val.vote === arr[0].vote);
        for (let idx in this.cards) {
          if (typeof this.cards[idx].vote === "number") {
            score += this.cards[idx].vote;
            count++;
          }
        }

        if (!consensus && score > 0) {
          consensus = false;
        } else if (consensus && score > 0) {
          consensus = true;
        }

        return {
          averageVote: Math.round(count ? score / count : 0, 1),
          highestVote: isFinite(Math.max(...this.cards.filter(o => o.vote).map(o => o.vote))) ? Math.max(...this.cards.filter(o => o.vote).map(o => o.vote)) : 0,
          lowestVote: isFinite(Math.min(...this.cards.filter(o => o.vote).map(o => o.vote))) ? Math.min(...this.cards.filter(o => o.vote).map(o => o.vote)) : 0,
          totalVotes: count,
          consensus
        };
      },
    },
  };

  function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
      (
        c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16)
    );
  }

  /**
   * Generate random variants for the cards.
   *
   * @returns List of variants.
   */
  function randomVariants() {
    return [1, 2, 3, 5, 8, 13];
  }

  function fireConfetti() {
    var number = 200;
    var defaults = {
      origin: { y: 0.7 }
    };

    function fire(particleRatio, opts) {
      confetti(Object.assign({}, defaults, opts, {
        particleCount: Math.floor(number * particleRatio)
      }));
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });
  }

  function generateAvatar(backgroundColor) {
    const text = localStorage.getItem("playerName").match(/(\b\S)?/g).join("").match(/(^\S|\S$)?/g).join("").toUpperCase();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    foregroundColor = "#ffffff";

    canvas.width = 200;
    canvas.height = 200;

    // Draw background
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw text
    context.font = "bold 120px Roboto";
    context.fillStyle = foregroundColor;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    document.getElementById("avatar").src = canvas.toDataURL("image/png");
  }

  function setModeratorColor() {
    document.getElementById("logo-text").classList.toggle('moderator');
    document.getElementById("glowing-logo-text").classList.toggle('moderator');
    document.getElementById("avatar").classList.toggle('moderator');
    generateAvatar(MODERATOR_COLOR_PRIMARY);
    showNotification("You have joined as a moderator.");
  }

  function setParticipantColor() {
    document.getElementById("logo-text").classList.toggle('moderator');
    document.getElementById("glowing-logo-text").classList.toggle('moderator');
    document.getElementById("avatar").classList.toggle('moderator');
    generateAvatar(PARTICIPANT_COLOR_PRIMARY);
    showNotification("You have joined as a participant.");
  }

  function showNotification(text) {
    document.getElementById('notification').style.display = 'block';
    document.getElementById('notification-text').innerHTML = text;
    setTimeout(function () {
      document.getElementById('notification').style.display = 'none';
    }, 4000);
  }

  // Register service worker to use the app as PWA.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("/service-worker.js", { scope: window.location.href })
        .then((res) => console.log("service worker registered"))
        .catch((err) => console.log("service worker not registered", err));
    });
  }

  // Required for the right Vue template initialization.
  setTimeout(() => {
    Vue.createApp(App).mount("#app");
  });
})();
