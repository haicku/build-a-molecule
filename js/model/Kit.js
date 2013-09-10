// Copyright 2002-2013, University of Colorado

/**
 * Contains multiple buckets of different types of atoms
 *
 * @author Jonathan Olson <olsonsjc@gmail.com>
 */

define( function( require ) {
  'use strict';
  
  var assert = require( 'ASSERT/assert' )( 'build-a-molecule' );
  var inherit = require( 'PHET_CORE/inherit' );
  var namespace = require( 'BAM/namespace' );
  var PropertySet = require( 'AXON/PropertySet' );
  var Vector2 = require( 'DOT/Vector2' );
  var Rectangle = require( 'DOT/Rectangle' );
  var Molecule = require( 'BAM/model/Molecule' );
  var MoleculeStructure = require( 'BAM/model/MoleculeStructure' );
  var LewisDotModel = require( 'BAM/model/LewisDotModel' );
  
  /*
   * Events:
   *   addedMolecule: function( molecule )
   *   removedMolecule: function( molecule )
   */
  
  var Kit = namespace.Kit = function Kit( layoutBounds, buckets ) {
    PropertySet.call( this, {
      visible: false,
      hasMoleculesInBoxes: false // we record this so we know when the "reset kit" should be shown
    } );
    
    this.buckets = buckets;
    this.layoutBounds = layoutBounds;
    
    this.atoms = []; // our master list of atoms (in and out of buckets), but not ones in collection boxes
    this.atomsInCollectionBox = []; // atoms in the collection box
    this.lewisDotModel = null; // created later, lewis-dot connections between atoms on the play area
    this.molecules = []; // molecule structures in the play area
    this.removedMolecules = {}; // moleculeId => CollectionBox, molecule structures that were put into the collection box. kept for now, since modifying the reset behavior will be much easier if we retain this
    
    this.resetKit();
    
    this.layoutBuckets( buckets );
  };
  
  inherit( PropertySet, Kit, {
    resetKit: function() {
      var kit = this;
      
      // not resetting visible, since that is not handled by us
      this.hasMoleculesInBoxesProperty.reset();

      // take molecules back from the collection boxes
//          for ( Pair<MoleculeStructure, CollectionBox> removedMolecule : removedMolecules ) {
//              removedMolecule._2.removeMolecule( removedMolecule._1 );
//          }

      // send out notifications for all removed molecules
      _.each( this.molecules.slice( 0 ), this.removeMolecule.bind( this ) );

      // put everything back in buckets
      _.each( this.atoms.concat( this.atomsInCollectionBox ), function( atom ) {
        // reset the actual atom
        atom.reset();
        
        // THEN place it so we overwrite its "bad" position and destination info
        kit.getBucketForElement( atom.element ).placeAtom( atom );
      } );

      // if reset kit ignores collection boxes, add in other atoms that are equivalent to how the bucket started
      // NOTE: right now, the actual atom models move back to the buckets even though the virtual "molecule" says in the box. consider moving it!

      // wipe our internal state
      this.atoms.length = 0;
      this.atomsInCollectionBox.length = 0;
      this.lewisDotModel = new LewisDotModel();
      this.molecules.length = 0;
      this.removedMolecules = {};

      // keep track of all atoms in our kit
      _.each( this.buckets, function( bucket ) {
        kit.atoms = kit.atoms.concat( bucket.atoms );
        
        _.each( bucket.atoms, function( atom ) {
          kit.lewisDotModel.addAtom( atom );
        } );
      } );
    },

    layoutBuckets: function( buckets ) {
      var kitY = this.availableKitBounds.centerY - 20;
      var kitXCenter = this.availableKitBounds.centerX;

      var usedWidth = 0;

      // lays out all of the buckets from the left to right
      for ( var i = 0; i < buckets.length; i++ ) {
        var bucket = buckets[i];
        if ( i !== 0 ) {
            usedWidth += Kit.bucketPadding;
        }
        bucket.position = new Vector2( usedWidth, kitY );
        usedWidth += bucket.width;
      }

      // centers the buckets horizontally within the kit
      _.each( buckets, function( bucket ) {
        // also note: this moves the atoms also!
        bucket.position = new Vector2( bucket.position.x - usedWidth / 2 + kitXCenter + bucket.width / 2, kitY );
      } );
    },

    show: function() {
      this.visible = true;
    },

    hide: function() {
      this.visible = false;
    },

    isContainedInBucket: function( atom ) {
      return _.some( this.buckets, function( bucket ) {
        return bucket.containsParticle( atom );
      } );
    },

    getBucketForElement: function( element ) {
      return _.find( this.buckets, function( bucket ) {
        return bucket.element.isSameElement( element );
      } );
    },

    get availableKitBounds() {
      return this.layoutBounds.availableKitBounds;
    },

    get availablePlayAreaBounds() {
      return this.layoutBounds.availablePlayAreaBounds;
    },

    /**
     * Called when an atom is dropped within either the play area OR the kit area. This will NOT be called for molecules
     * dropped into the collection area successfully
     *
     * @param atom The dropped atom.
     */
    atomDropped: function( atom ) {
      // dropped on kit, put it in a bucket
      var wasInPlay = this.isAtomInPlay( atom );
      var droppedInKitArea = this.availableKitBounds.containsPoint( atom.position );
      
      if ( droppedInKitArea ) {
        if ( wasInPlay ) {
          this.recycleMoleculeIntoBuckets( this.getMolecule( atom ) );
        } else {
          this.recycleAtomIntoBuckets( atom, true ); // animate
        }
      } else {
        // dropped in play area
        if ( wasInPlay ) {
          this.attemptToBondMolecule( this.getMolecule( atom ) );
          this.separateMoleculeDestinations();
        } else {
          this.addAtomToPlay( atom );
        }
      }
    },

    /**
     * Called when an atom is dragged, with the corresponding delta
     *
     * @param atom  Atom that was dragged
     * @param {Vector2} delta How far it was dragged (the delta)
     */
    atomDragged: function( atom, delta ) {
      // move our atom
      atom.translatePositionAndDestination( delta );

      // move all other atoms in the molecule
      if ( this.isAtomInPlay( atom ) ) {
        var atoms = this.getMolecule( atom ).atoms;
        for ( var i = 0; i < atoms.length; i++ ) {
          var atomInMolecule = atoms[i];
          if ( atom === atomInMolecule ) {
            continue;
          }
          atomInMolecule.translatePositionAndDestination( delta );
        }
      }
    },

    /**
     * Called when a molecule is dragged (successfully) into a collection box
     *
     * @param molecule The molecule
     * @param {CollectionBox{ box      Its collection box
     */
    moleculePutInCollectionBox: function( molecule, box ) {
      var kit = this;
      window.console && console.log && console.log( 'You have collected: ' + box.moleculeType.commonName );
      this.hasMoleculesInBoxes = true;
      this.removeMolecule( molecule );
      _.each( molecule.atoms, function( atom ) {
        kit.atoms.splice( kit.atoms.indexOf( atom ), 1 ); // TODO: remove() instead of splice()
        kit.atomsInCollectionBox.push( atom );
        atom.visible.set( false );
      } );
      box.addMolecule( molecule );
      this.removedMolecules[molecule.moleculeId] = box;
    },

    /**
     * @param atom An atom
     * @return Is this atom registered in our molecule structures?
     */
    isAtomInPlay: function( atom ) {
      return this.getMolecule( atom ) !== null;
    },

    getMolecule: function( atom ) {
      // TODO: performance: seems like this could be a bottleneck? faster ways?
      var numMolecules = this.molecules.length;
      for ( var i = 0; i < numMolecules; i++ ) {
        var molecule = this.molecules[i];
        
        var numAtoms = molecule.atoms.length;
        for ( var j = 0; j < numAtoms; j++ ) {
          var otherAtom = molecule.atoms[j];
          if ( otherAtom === atom ) {
            return molecule;
          }
        }
      }
      return null;
    },

    /**
     * Breaks apart a molecule into separate atoms that remain in the play area
     *
     * @param molecule The molecule to break
     */
    breakMolecule: function( molecule ) {
      var kit = this;
      var createdMolecules = [];

      this.removeMolecule( molecule );
      _.each( molecule.atoms, function( atom ) {
        kit.lewisDotModel.breakBondsOfAtom( atom );
        
        var newMolecule = new Molecule();
        newMolecule.addAtom( atom );
        
        kit.addMolecule( newMolecule );
        createdMolecules.push( molecule );
      } );
      this.separateMoleculeDestinations();
    },

    /**
     * Breaks a bond between two atoms in a molecule.
     *
     * @param {Atom2} a Atom A
     * @param {Atom2} b Atom B
     */
    breakBond: function( a, b ) {
      // get our old and new molecule structures
      var oldMolecule = this.getMolecule( a );
      var newMolecules = MoleculeStructure.getMoleculesFromBrokenBond( oldMolecule, oldMolecule.getBond( a, b ), new Molecule(), new Molecule() );

      // break the bond in our lewis dot model
      this.lewisDotModel.breakBond( a, b );

      // remove the old one, add the new ones (firing listeners)
      this.removeMolecule( oldMolecule );
      _.each( newMolecules, this.addMolecule.bind( this ) );

      // push the new separate molecules away
      this.separateMoleculeDestinations();
    },

    getBondDirection: function( a, b ) {
      return this.lewisDotModel.getBondDirection( a, b );
    },

    hasAtomsOutsideOfBuckets: function() {
      return this.molecules.length || this.hasMoleculesInBoxes;
    },

    /*---------------------------------------------------------------------------*
    * model implementation
    *----------------------------------------------------------------------------*/

    addMolecule: function( molecule ) {
      this.molecules.push( molecule );
      
      this.trigger( 'addedMolecule', molecule );
    },

    removeMolecule: function( molecule ) {
      this.molecules.splice( this.molecules.indexOf( molecule ), 1 ); // TODO: remove() instead of splice()
      
      this.trigger( 'removedMolecule', molecule );
    },

    /**
     * Takes an atom that was in a bucket and hooks it up within our structural model. It allocates a molecule for the
     * atom, and then attempts to bond with it.
     *
     * @param {Atom2} atom An atom to add into play
     */
    addAtomToPlay: function( atom ) {
      // add the atoms to our models
      var molecule = new Molecule();
      molecule.addAtom( atom );

      this.addMolecule( molecule );

      // attempt to bond
      this.attemptToBondMolecule( molecule );
    },

    /**
     * Takes an atom, invalidates the structural bonds it may have, and puts it in the correct bucket
     *
     * @param {Atom2} atom    The atom to recycle
     * @param {Boolean} animate Whether we should display animation
     */
    recycleAtomIntoBuckets: function( atom, animate ) {
      this.lewisDotModel.breakBondsOfAtom( atom );
      var bucket = this.getBucketForElement( atom.element );
      bucket.addParticleNearestOpen( atom, animate );
    },

    /**
     * Recycles an entire molecule by invalidating its bonds and putting its atoms into their respective buckets
     *
     * @param molecule The molecule to recycle
     */
    recycleMoleculeIntoBuckets: function( molecule ) {
      var kit = this;
      _.each( molecule.atoms, function( atom ) {
        kit.recycleAtomIntoBuckets( atom, true );
      } );
      this. removeMolecule( molecule );
    },

    padMoleculeBounds: function( bounds ) {
      var halfPadding = Kit.interMoleculePadding / 2;
      return new Rectangle( bounds.x - halfPadding, bounds.y - halfPadding, bounds.width + Kit.interMoleculePadding, bounds.height + Kit.interMoleculePadding );
    },

    /**
     * Update atom destinations so that separate molecules will be separated visually
     */
    separateMoleculeDestinations: function() {
      // TODO: performance: general optimization
      var kit = this;
      var maxIterations = 500;
      var pushAmount = 10; // how much to push two molecules away
      
      var availablePlayAreaBounds = this.availablePlayAreaBounds;

      var foundOverlap = true;
      while ( foundOverlap && maxIterations-- >= 0 ) {
        foundOverlap = false;
        var numMolecules = this.molecules.length;
        for ( var i = 0; i < numMolecules; i++ ) {
          var a = this.molecules[i];
          
          var aBounds = this.padMoleculeBounds( a.destinationBounds );

          // push it away from the outsides
          if ( aBounds.minX < availablePlayAreaBounds.minX ) {
            a.shiftDestination( new Vector2( availablePlayAreaBounds.minX - aBounds.minX, 0 ) );
            aBounds = this.padMoleculeBounds( a.destinationBounds );
          }
          if ( aBounds.maxX > availablePlayAreaBounds.maxX ) {
            a.shiftDestination( new Vector2( availablePlayAreaBounds.maxX - aBounds.maxX, 0 ) );
            aBounds = this.padMoleculeBounds( a.destinationBounds );
          }
          if ( aBounds.minY < availablePlayAreaBounds.minY ) {
            a.shiftDestination( new Vector2( 0, availablePlayAreaBounds.minY - aBounds.minY ) );
            aBounds = this.padMoleculeBounds( a.destinationBounds );
          }
          if ( aBounds.maxY > availablePlayAreaBounds.maxY ) {
            a.shiftDestination( new Vector2( 0, availablePlayAreaBounds.maxY - aBounds.maxY ) );
          }

          // then separate it from other molecules
          for ( var k = 0; k < numMolecules; k++ ) {
            var b = this.molecules[k];
            
            if ( a.moleculeId >= b.moleculeId ) {
              // this removes the case where a == b, and will make sure we don't run the following code twice for (a,b) and (b,a)
              continue;
            }
            var bBounds = this.padMoleculeBounds( b.destinationBounds );
            if ( aBounds.intersectsBounds( bBounds ) ) {
              foundOverlap = true;

              // get perturbed centers. this is so that if two molecules have the exact same centers, we will push them away
              var aCenter = aBounds.center.plus( Math.random() - 0.5, Math.random() - 0.5 );
              var bCenter = bBounds.center.plus( Math.random() - 0.5, Math.random() - 0.5 );

              // delta from center of A to center of B, scaled to half of our push amount.
              var delta = bCenter.minus( aCenter ).normalized().times( pushAmount );

              // how hard B should be pushed (A will be pushed (1-pushRatio)). Heuristic, power is to make the ratio not too skewed
              // this is done so that heavier molecules will be pushed less, while lighter ones will be pushed more
              var pushPower = 1;
              var pushRatio = Math.pow( a.getApproximateMolecularWeight(), pushPower ) / ( Math.pow( a.getApproximateMolecularWeight(), pushPower ) + Math.pow( b.getApproximateMolecularWeight(), pushPower ) );

              // push B by the pushRatio
              b.shiftDestination( delta.times( pushRatio ) );

              // push A the opposite way, by (1 - pushRatio)
              var delta1 = delta.times( -1 * ( 1 - pushRatio ) );
              a.shiftDestination( delta1 );

              aBounds = this.padMoleculeBounds( a.destinationBounds );
            }
          }
        }
      }
    },

    /**
     * Bonds one atom to another, and handles the corresponding structural changes between molecules.
     *
     * @param {Atom2} a       An atom A
     * @param {Direction} dirAtoB The direction from A that the bond will go in (for lewis-dot structure)
     * @param {Atom2} b       An atom B
     */
    bond: function( a, dirAtoB, b ) {
      this.lewisDotModel.bond( a, dirAtoB, b );
      var molA = this.getMolecule( a );
      var molB = this.getMolecule( b );
      if ( molA === molB ) {
        throw new Error( 'WARNING: loop or other invalid structure detected in a molecule' );
      }

      var newMolecule = MoleculeStructure.getCombinedMoleculeFromBond( molA, molB, a, b, new Molecule() );

      // sanity check and debugging information
      if ( !newMolecule.isValid() ) {
        // TODO: performance: strip this out for the runtime?
        window.console && console.log && console.log( 'invalid molecule!' );
        window.console && console.log && console.log( 'bonding: ' + a.symbol + '(' + a.reference + '), ' + dirAtoB + ' ' + b.symbol + ' (' + b.reference + ')' );
        window.console && console.log && console.log( 'A' );
        window.console && console.log && console.log( molA.getDebuggingDump() );
        window.console && console.log && console.log( 'B' );
        window.console && console.log && console.log( molB.getDebuggingDump() );
        window.console && console.log && console.log( 'combined' );
        window.console && console.log && console.log( newMolecule.getDebuggingDump() );

        window.console && console.log && console.log( 'found: ' + newMolecule.isAllowedStructure() );

        // just exit out for now
        return;
      }

      this.removeMolecule( molA );
      this.removeMolecule( molB );
      this.addMolecule( newMolecule );

      /*---------------------------------------------------------------------------*
      * bonding diagnostics and sanity checks
      *----------------------------------------------------------------------------*/

      var serializedForm = this.getMolecule( a ).toSerial2();
      window.console && console.log && console.log( 'created structure: ' + serializedForm );
      var structure = this.getMolecule( a );
      if ( structure.atoms.length > 2 ) {
        _.each( structure.bonds, function( bond ) {
          if ( bond.a.hasSameElement( bond.b ) && bond.a.symbol.equals( 'H' ) ) {
            window.console && console.log && console.log( 'WARNING: Hydrogen bonded to another hydrogen in a molecule which is not diatomic hydrogen' );
          }
        } );
      }

      assert && assert( this.getMolecule( a ) === this.getMolecule( b ) );
    },

    // {Atom2}s
    getPossibleMoleculeStructureFromBond: function( a, b ) {
      var molA = this.getMolecule( a );
      var molB = this.getMolecule( b );
      assert && assert( molA !== molB );

      return MoleculeStructure.getCombinedMoleculeFromBond( molA, molB, a, b, new Molecule() );
    },

    /**
     * @param molecule A molecule that should attempt to bind to other atoms / molecules
     * @return Success
     */
    attemptToBondMolecule: function( molecule ) {
      var kit = this;
      var bestLocation = null; // {BondingOption}
      var bestDistanceFromIdealLocation = Number.POSITIVE_INFINITY;

      // for each atom in our molecule, we try to see if it can bond to other atoms
      _.each( molecule.atoms, function( ourAtom ) {
        
        // all other atoms
        _.each( kit.atoms, function( otherAtom ) {
          // disallow loops in an already-connected molecule
          if ( kit.getMolecule( otherAtom ) === molecule ) {
            return;
          }

          // don't bond to something in a bucket!
          if ( !kit.isContainedInBucket( otherAtom ) ) {

            // sanity check, and run it through our molecule structure model to see if it would be allowable
            if ( otherAtom === ourAtom || !kit.canBond( ourAtom, otherAtom ) ) {
                return;
            }
            
            _.each( kit.lewisDotModel.getOpenDirections( otherAtom ), function( otherDirection ) {
              var direction = otherDirection.opposite;
              if ( !_.contains( kit.lewisDotModel.getOpenDirections( ourAtom ), direction ) ) {
                // the spot on otherAtom was open, but the corresponding spot on our main atom was not
                return;
              }

              // check the lewis dot model to make sure we wouldn't have two "overlapping" atoms that aren't both hydrogen
              if ( !kit.lewisDotModel.willAllowBond( ourAtom, direction, otherAtom ) ) {
                return;
              }

              var location = new BondingOption( otherAtom, otherDirection, ourAtom );
              var distance = ourAtom.position.distance( location.idealLocation );
              if ( distance < bestDistanceFromIdealLocation ) {
                bestLocation = location;
                bestDistanceFromIdealLocation = distance;
              }
            } );
          }
        } );
      } );


      // if our closest bond is too far, then ignore it
      var isBondingInvalid = bestLocation === null || bestDistanceFromIdealLocation > Kit.bondDistanceThreshold;

      if ( isBondingInvalid ) {
        return false;
      }

      // cause all atoms in the molecule to move to that location
      var delta = bestLocation.idealLocation.minus( bestLocation.b.position );
      _.each( this.getMolecule( bestLocation.b ).atoms, function( atomInMolecule ) {
        atomInMolecule.destination = atomInMolecule.position.plus( delta );
      } );

      // we now will bond the atom
      this.bond( bestLocation.a, bestLocation.direction, bestLocation.b ); // model bonding
      return true;
    },
    
    // {Atom2}s
    canBond: function( a, b ) {
      return this.getMolecule( a ) !== this.getMolecule( b ) && this.getPossibleMoleculeStructureFromBond( a, b ).isAllowedStructure();
    }
  } );
  
  // A bond option from A to B. B would be moved to the location near A to bond.
  var BondingOption = Kit.BondingOption = function BondingOption( a, direction, b ) {
    this.a = a;
    this.direction = direction;
    this.b = b;
    
    // The location the atom should be placed
    this.idealLocation = a.position.plus( direction.vector.times( a.radius + b.radius ) );
  };
  
  Kit.bondDistanceThreshold = 200;
  Kit.bucketPadding = 50;
  Kit.interMoleculePadding = 150;
  
  return Kit;
} );
